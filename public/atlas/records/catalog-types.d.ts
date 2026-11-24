/** Native compact protobuf wire values, kept lossless at the local boundary. */
export type WireEntry = [tag: number, value: number | string | WireEntry[]];
