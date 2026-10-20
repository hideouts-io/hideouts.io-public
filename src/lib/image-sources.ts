export interface ImageSource {
  src: string;
  descriptor: string;
}

/** Parse README image candidates so download, rendering, and link checks agree. */
export function imageSources(sourceSet: string): ImageSource[] {
  return sourceSet.split(',').map((candidate) => {
    const fields = candidate.trim().split(/\s+/);
    const src = fields[0];
    const descriptor = fields[1] ?? '';
    if (
      !src ||
      fields.length > 2 ||
      (descriptor && (!/^(?:\d+w|\d+(?:\.\d+)?x)$/.test(descriptor) || Number.parseFloat(descriptor) <= 0))
    ) {
      throw new Error(`Invalid README image source candidate: "${candidate}" in srcset "${sourceSet}"`);
    }
    return { src, descriptor };
  });
}
