import crypto from "crypto";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { config } from "../config";

/**
 * Armazenamento dos arquivos anexados, em disco (UPLOADS_DIR; no Docker, um volume).
 *
 * O nome no disco é um id aleatório, nunca o nome enviado pelo usuário: isso impede que um nome
 * como "../../etc/passwd" escape da pasta e evita colisões. O nome original fica só no banco.
 * Trocar por um bucket S3/MinIO no futuro é reescrever só este módulo.
 */
const KEY_PATTERN = /^[a-f0-9]{2}\/[a-f0-9-]{36}$/;

function pathFor(key: string): string {
  if (!KEY_PATTERN.test(key)) throw new Error(`Chave de armazenamento inválida: ${key}`);
  return path.join(config.uploadsDir, key);
}

export async function saveFile(data: Buffer): Promise<string> {
  const id = crypto.randomUUID();
  // Subpastas pelos 2 primeiros caracteres: evita milhares de arquivos numa pasta só.
  const key = `${id.slice(0, 2)}/${id}`;
  const target = pathFor(key);
  await fsp.mkdir(path.dirname(target), { recursive: true });
  await fsp.writeFile(target, data, { flag: "wx" });
  return key;
}

export function openFile(key: string): fs.ReadStream {
  return fs.createReadStream(pathFor(key));
}

export async function fileExists(key: string): Promise<boolean> {
  try {
    await fsp.access(pathFor(key));
    return true;
  } catch {
    return false;
  }
}

export async function deleteFile(key: string): Promise<void> {
  await fsp.rm(pathFor(key), { force: true });
}
