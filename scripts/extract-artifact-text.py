"""Extract image text and search-index payloads without access to the private policy."""

import hashlib
import json
import os
import pathlib
import re
import subprocess
import sys
import xml.etree.ElementTree as ET
import zlib


MAX_FILE_BYTES = 32 * 1024 * 1024
MAX_TREE_BYTES = 512 * 1024 * 1024
MAX_EXTRACTION_BYTES = 128 * 1024 * 1024
MAX_FILES = 20_000
IMAGE_EXTENSIONS = {".avif", ".gif", ".ico", ".jpeg", ".jpg", ".png", ".webp"}
MAX_CABX_BYTES = 64 * 1024
MAX_CBOR_ITEMS = 4096
MAX_CBOR_DEPTH = 16
JUMBF_UUID_SUFFIX = bytes.fromhex("00110010800000aa00389b71")
EMBEDDED_FILE_UUID = bytes.fromhex("40cb0c32bb8a489da70b2ad6f47f4369")


def files_under(root: pathlib.Path) -> list[pathlib.Path]:
    files: list[pathlib.Path] = []
    total_bytes = 0
    for folder, directories, names in os.walk(root, followlinks=False):
        directories.sort()
        names.sort()
        for name in [*directories, *names]:
            path = pathlib.Path(folder, name)
            if path.is_symlink():
                raise ValueError("artifact extraction: symlink rejected")
        for name in names:
            path = pathlib.Path(folder, name)
            info = path.stat()
            if not path.is_file() or info.st_size > MAX_FILE_BYTES:
                raise ValueError("artifact extraction: unsupported file or size")
            total_bytes += info.st_size
            if total_bytes > MAX_TREE_BYTES or len(files) >= MAX_FILES:
                raise ValueError("artifact extraction: tree size or count limit exceeded")
            files.append(path)
    return files


def extract(command: list[str]) -> str:
    result = subprocess.run(command, capture_output=True, timeout=30, check=False)
    if result.returncode != 0 or len(result.stdout) > MAX_FILE_BYTES:
        raise ValueError("artifact extraction: parser failed or output exceeded limit")
    return result.stdout.decode("utf-8", errors="strict")


def bounded_inflate(data: bytes) -> bytes:
    decoder = zlib.decompressobj()
    content = decoder.decompress(data, MAX_FILE_BYTES + 1)
    if len(content) > MAX_FILE_BYTES or not decoder.eof or decoder.unused_data or decoder.unconsumed_tail:
        raise ValueError("artifact extraction: compressed metadata invalid or oversized")
    return content


def visible_bytes(data: bytes) -> str:
    return "\n".join(
        (
            data.decode("latin-1"),
            data.decode("utf-16-le", errors="replace"),
            data.decode("utf-16-be", errors="replace"),
        )
    )


def boxes(data: bytes) -> list[tuple[bytes, bytes]]:
    if not data or len(data) > MAX_CABX_BYTES:
        raise ValueError("artifact extraction: invalid metadata box stream size")
    result: list[tuple[bytes, bytes]] = []
    offset = 0
    while offset < len(data):
        if len(data) - offset < 8 or len(result) >= 16:
            raise ValueError("artifact extraction: invalid metadata box stream")
        size = int.from_bytes(data[offset : offset + 4], "big")
        if size < 8 or size > len(data) - offset:
            raise ValueError("artifact extraction: invalid metadata box length")
        result.append((data[offset + 4 : offset + 8], data[offset + 8 : offset + size]))
        offset += size
    return result


def description(payload: bytes, uuid: bytes, label: str | None, flags: int) -> str:
    if len(payload) < 18 or payload[:16] != uuid or payload[16] != flags:
        raise ValueError("artifact extraction: unsupported metadata description")
    end = payload.find(b"\x00", 17)
    if end < 0:
        raise ValueError("artifact extraction: unterminated metadata label")
    name = payload[17:end].decode("utf-8", errors="strict")
    if label is None:
        if re.fullmatch(r"urn:c2pa:[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}", name) is None:
            raise ValueError("artifact extraction: invalid manifest label")
    elif name != label:
        raise ValueError("artifact extraction: unexpected metadata label")
    trailer = payload[end + 1 :]
    if flags == 3 and trailer:
        raise ValueError("artifact extraction: unexpected metadata description content")
    if flags == 19:
        details = boxes(trailer)
        if len(details) != 1 or details[0][0] != b"c2sh" or len(details[0][1]) != 16:
            raise ValueError("artifact extraction: unsupported metadata description content")
    return name


def superbox(payload: bytes, uuid: bytes, label: str | None, flags: int) -> list[tuple[bytes, bytes]]:
    children = boxes(payload)
    if len(children) < 2 or children[0][0] != b"jumd":
        raise ValueError("artifact extraction: incomplete metadata superbox")
    description(children[0][1], uuid, label, flags)
    return children[1:]


def compressed_payload(data: bytes) -> bool:
    if data.startswith((b"\x1f\x8b", b"PK\x03\x04", b"\x28\xb5\x2f\xfd")):
        return True
    return len(data) >= 2 and data[0] & 15 == 8 and (data[0] * 256 + data[1]) % 31 == 0


def cbor_item(data: bytes, offset: int, depth: int, remaining: int) -> tuple[int, list[str], int]:
    if depth > MAX_CBOR_DEPTH or remaining < 1 or offset >= len(data):
        raise ValueError("artifact extraction: CBOR depth, item, or length limit exceeded")
    initial = data[offset]
    offset += 1
    major = initial >> 5
    additional = initial & 31
    if additional < 24:
        argument = additional
    elif additional in (24, 25, 26, 27):
        width = {24: 1, 25: 2, 26: 4, 27: 8}[additional]
        if offset + width > len(data):
            raise ValueError("artifact extraction: truncated CBOR argument")
        argument = int.from_bytes(data[offset : offset + width], "big")
        offset += width
    else:
        raise ValueError("artifact extraction: indefinite or unsupported CBOR argument")
    remaining -= 1
    if major in (0, 1):
        return offset, [], remaining
    if major in (2, 3):
        if argument > MAX_CABX_BYTES or argument > len(data) - offset:
            raise ValueError("artifact extraction: truncated or oversized CBOR string")
        content = data[offset : offset + argument]
        if major == 2:
            if compressed_payload(content):
                raise ValueError("artifact extraction: compressed metadata content unsupported")
            text = visible_bytes(content)
        else:
            text = content.decode("utf-8", errors="strict")
        return offset + argument, [text], remaining
    if major in (4, 5):
        count = argument * (2 if major == 5 else 1)
        if count > remaining:
            raise ValueError("artifact extraction: CBOR item limit exceeded")
        strings: list[str] = []
        for _ in range(count):
            offset, nested, remaining = cbor_item(data, offset, depth + 1, remaining)
            strings.extend(nested)
        return offset, strings, remaining
    if major == 6 and argument in (0, 18):
        return cbor_item(data, offset, depth + 1, remaining)
    if major == 7 and additional in (20, 21, 22, 23):
        return offset, [], remaining
    raise ValueError("artifact extraction: unsupported CBOR value or tag")


def cbor_metadata(payload: bytes) -> str:
    offset, strings, _ = cbor_item(payload, 0, 0, MAX_CBOR_ITEMS)
    if offset != len(payload):
        raise ValueError("artifact extraction: trailing CBOR content")
    return "\n".join(strings)


def svg_metadata(payload: bytes) -> str:
    if len(payload) > 16 * 1024 or b"<!" in payload or b"<?" in payload:
        raise ValueError("artifact extraction: unsupported embedded SVG content")
    source = payload.decode("utf-8", errors="strict")
    try:
        root = ET.fromstring(source)
    except ET.ParseError as error:
        raise ValueError("artifact extraction: malformed embedded SVG") from error
    namespace = "{http://www.w3.org/2000/svg}"
    if root.tag != namespace + "svg":
        raise ValueError("artifact extraction: invalid embedded SVG root")
    for element in root.iter():
        if element.tag not in (namespace + "svg", namespace + "path"):
            raise ValueError("artifact extraction: unsupported embedded SVG element")
        if (element.text and element.text.strip()) or (element.tail and element.tail.strip()):
            raise ValueError("artifact extraction: unexpected embedded SVG text")
        for name, value in element.attrib.items():
            if name not in ("width", "height", "viewBox", "fill", "d") or re.search(
                r"(?i)(?:url\s*\(|javascript:|data:|https?:|file:|@import)", value
            ):
                raise ValueError("artifact extraction: embedded SVG reference or attribute unsupported")
    return source


def cabx_metadata(payload: bytes) -> str:
    if len(payload) > MAX_CABX_BYTES:
        raise ValueError("artifact extraction: oversized manifest chunk")
    outer = boxes(payload)
    if len(outer) != 1 or outer[0][0] != b"jumb":
        raise ValueError("artifact extraction: unsupported manifest root")
    root = superbox(outer[0][1], b"c2pa" + JUMBF_UUID_SUFFIX, "c2pa", 3)
    if len(root) != 1 or root[0][0] != b"jumb":
        raise ValueError("artifact extraction: unsupported manifest store")
    manifest = superbox(root[0][1], b"c2ma" + JUMBF_UUID_SUFFIX, None, 3)
    if len(manifest) != 3 or any(kind != b"jumb" for kind, _ in manifest):
        raise ValueError("artifact extraction: unsupported manifest structure")
    assertions = superbox(manifest[0][1], b"c2as" + JUMBF_UUID_SUFFIX, "c2pa.assertions", 3)
    if len(assertions) != 3 or any(kind != b"jumb" for kind, _ in assertions):
        raise ValueError("artifact extraction: unsupported assertion structure")
    icon = superbox(assertions[0][1], EMBEDDED_FILE_UUID, "c2pa.icon", 19)
    if len(icon) != 2 or icon[0] != (b"bfdb", b"\x00image/svg+xml\x00") or icon[1][0] != b"bidb":
        raise ValueError("artifact extraction: unsupported embedded file")
    texts = [svg_metadata(icon[1][1])]
    for box, name in ((assertions[1], "c2pa.actions.v2"), (assertions[2], "c2pa.hash.data")):
        contents = superbox(box[1], b"cbor" + JUMBF_UUID_SUFFIX, name, 19)
        if len(contents) != 1 or contents[0][0] != b"cbor":
            raise ValueError("artifact extraction: unsupported assertion content")
        texts.append(cbor_metadata(contents[0][1]))
    for box, uuid, name in (
        (manifest[1], b"c2cl" + JUMBF_UUID_SUFFIX, "c2pa.claim.v2"),
        (manifest[2], b"c2cs" + JUMBF_UUID_SUFFIX, "c2pa.signature"),
    ):
        contents = superbox(box[1], uuid, name, 3)
        if len(contents) != 1 or contents[0][0] != b"cbor":
            raise ValueError("artifact extraction: unsupported claim content")
        texts.append(cbor_metadata(contents[0][1]))
    return "\n".join([visible_bytes(payload), *texts])


def png_metadata(data: bytes) -> str:
    if not data.startswith(b"\x89PNG\r\n\x1a\n"):
        raise ValueError("artifact extraction: invalid PNG signature")
    offset = 8
    metadata: list[str] = []
    allowed = {b"IHDR", b"PLTE", b"IDAT", b"IEND", b"pHYs", b"bKGD", b"sRGB", b"gAMA", b"cHRM", b"tRNS", b"sBIT"}
    metadata_chunks = {b"tEXt", b"zTXt", b"iTXt", b"iCCP", b"eXIf"}
    saw_end = False
    saw_header = False
    saw_pixels = False
    saw_manifest = False
    chunks = 0
    while offset + 12 <= len(data):
        chunks += 1
        if chunks > 4096:
            raise ValueError("artifact extraction: PNG chunk count limit exceeded")
        size = int.from_bytes(data[offset : offset + 4], "big")
        kind = data[offset + 4 : offset + 8]
        end = offset + 12 + size
        if end > len(data) or size > MAX_FILE_BYTES:
            raise ValueError("artifact extraction: invalid PNG chunk length")
        payload = data[offset + 8 : offset + 8 + size]
        checksum = int.from_bytes(data[offset + 8 + size : end], "big")
        if zlib.crc32(kind + payload) != checksum:
            raise ValueError("artifact extraction: invalid PNG chunk checksum")
        if kind not in allowed and kind not in metadata_chunks and kind != b"caBX":
            raise ValueError("artifact extraction: unsupported PNG metadata chunk")
        if kind == b"IHDR":
            if saw_header or offset != 8 or size != 13:
                raise ValueError("artifact extraction: invalid PNG header")
            saw_header = True
        elif not saw_header:
            raise ValueError("artifact extraction: missing PNG header")
        if kind == b"IEND" and size != 0:
            raise ValueError("artifact extraction: invalid PNG end chunk")
        if kind == b"IDAT":
            saw_pixels = True
        if kind == b"caBX":
            if saw_manifest or saw_pixels:
                raise ValueError("artifact extraction: duplicate or misplaced manifest chunk")
            metadata.append(cabx_metadata(payload))
            saw_manifest = True
        if kind == b"zTXt" or kind == b"iCCP":
            keyword, separator, compressed = payload.partition(b"\x00")
            if not separator or not compressed or compressed[0] != 0:
                raise ValueError("artifact extraction: malformed compressed PNG metadata")
            metadata.append(visible_bytes(keyword + b"\n" + bounded_inflate(compressed[1:])))
        elif kind == b"iTXt":
            keyword, separator, rest = payload.partition(b"\x00")
            if not separator or len(rest) < 2 or rest[1] != 0:
                raise ValueError("artifact extraction: malformed international PNG metadata")
            language, separator, rest = rest[2:].partition(b"\x00")
            translated, separator2, content = rest.partition(b"\x00")
            if not separator or not separator2:
                raise ValueError("artifact extraction: malformed international PNG metadata")
            if payload[len(keyword) + 1] == 1:
                content = bounded_inflate(content)
            elif payload[len(keyword) + 1] != 0:
                raise ValueError("artifact extraction: unsupported PNG compression flag")
            metadata.append(visible_bytes(keyword + b"\n" + language + b"\n" + translated + b"\n" + content))
        elif kind in metadata_chunks:
            metadata.append(visible_bytes(payload))
        offset = end
        if kind == b"IEND":
            saw_end = True
            break
    if not saw_header or not saw_end or offset != len(data) or (saw_manifest and not saw_pixels):
        raise ValueError("artifact extraction: incomplete PNG")
    return "\n".join(metadata)


def webp_metadata(data: bytes) -> str:
    if len(data) < 12 or data[:4] != b"RIFF" or data[8:12] != b"WEBP":
        raise ValueError("artifact extraction: invalid WebP signature")
    if int.from_bytes(data[4:8], "little") + 8 != len(data):
        raise ValueError("artifact extraction: invalid WebP length")
    offset = 12
    while offset + 8 <= len(data):
        kind = data[offset : offset + 4]
        size = int.from_bytes(data[offset + 4 : offset + 8], "little")
        end = offset + 8 + size + (size & 1)
        if end > len(data) or kind not in {b"VP8 ", b"VP8L", b"VP8X", b"ALPH"}:
            raise ValueError("artifact extraction: unsupported WebP chunk or size")
        if kind == b"VP8X":
            header = data[offset + 8 : offset + 8 + size]
            if size != 10 or header[0] not in (0, 0x10) or header[1:4] != b"\x00\x00\x00":
                raise ValueError("artifact extraction: WebP metadata or animation unsupported")
        offset = end
    if offset != len(data):
        raise ValueError("artifact extraction: incomplete WebP")
    return ""


def image_record(path: pathlib.Path, relative_path: str, digest: str) -> dict[str, str]:
    data = path.read_bytes()
    extension = path.suffix.lower()
    if extension == ".png":
        parsed_metadata = png_metadata(data)
    elif extension == ".webp":
        parsed_metadata = webp_metadata(data)
    elif extension == ".ico":
        parsed_metadata = ""
    else:
        raise ValueError("artifact extraction: image format requires format-specific review")
    metadata = parsed_metadata + "\n" + extract(["exiftool", "-G1", "-s", "-s", "-s", "-a", "-u", "-all", "--", str(path)])
    if path.suffix.lower() == ".ico":
        return {
            "path": relative_path,
            "sha256": digest,
            "ocr": "",
            "metadata": metadata,
            "ocr_status": "manual",
        }
    ocr = extract(["tesseract", str(path), "stdout"])
    return {
        "path": relative_path,
        "sha256": digest,
        "ocr": ocr,
        "metadata": metadata,
        "ocr_status": "checked",
    }


def search_record(path: pathlib.Path, relative_path: str, digest: str) -> dict[str, str]:
    decoder = zlib.decompressobj(wbits=31)
    decoded = decoder.decompress(path.read_bytes(), MAX_FILE_BYTES + 1)
    if len(decoded) > MAX_FILE_BYTES or not decoder.eof or decoder.unused_data or decoder.unconsumed_tail:
        raise ValueError("artifact extraction: search payload invalid or oversized")
    try:
        text = decoded.decode("utf-8", errors="strict")
        status = "text"
    except UnicodeDecodeError:
        text = decoded.decode("latin-1")
        status = "binary"
    return {"path": relative_path, "sha256": digest, "decoded_text": text, "status": status}


def main() -> None:
    os.umask(0o077)
    if len(sys.argv) != 3:
        raise ValueError("usage: extract-artifact-text.py ARTIFACT_ROOT OUTPUT_JSON")
    root = pathlib.Path(sys.argv[1]).resolve(strict=True)
    output = pathlib.Path(sys.argv[2])
    images: list[dict[str, str]] = []
    search_files: list[dict[str, str]] = []
    for path in files_under(root):
        relative_path = path.relative_to(root).as_posix()
        extension = path.suffix.lower()
        if extension not in IMAGE_EXTENSIONS and not extension.startswith(".pf_") and extension != ".pagefind":
            continue
        # Generated fetch inputs are never reused by the manual release run;
        # only committed public assets and the final output need image parsing.
        if relative_path.startswith(".cache/github/") and extension in IMAGE_EXTENSIONS:
            continue
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if extension in IMAGE_EXTENSIONS:
            images.append(image_record(path, relative_path, digest))
        else:
            search_files.append(search_record(path, relative_path, digest))
    content = json.dumps({"schema": 1, "images": images, "search_files": search_files}, ensure_ascii=False) + "\n"
    if len(content.encode("utf-8")) > MAX_EXTRACTION_BYTES:
        raise ValueError("artifact extraction: output size limit exceeded")
    with output.open("x", encoding="utf-8") as stream:
        stream.write(content)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, UnicodeError, subprocess.TimeoutExpired) as error:
        print(f"artifact extraction failed: {type(error).__name__}", file=sys.stderr)
        sys.exit(1)
