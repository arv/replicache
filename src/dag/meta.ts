import {meta} from './meta_generated.js';
import * as flatbuffers from 'flatbuffers';

type Meta = meta.Meta;

export function getRootAsMeta(bytes: Uint8Array): Meta {
  const buf = new flatbuffers.ByteBuffer(bytes);
  return meta.Meta.getRootAsMeta(buf);
}

export type {Meta};
