import fs from "fs";
import path from "path";

type Store = { knownItems: string[]; titles: string[] };

const inVercel = !!process.env.VERCEL;
const DATA_PATH = path.join(process.cwd(), ".data.json");

const readFileStore = async (): Promise<Store> => {
  if (!fs.existsSync(DATA_PATH)) return { knownItems: [], titles: [] };
  return JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
};

const writeFileStore = async (s: Store) => {
  fs.writeFileSync(DATA_PATH, JSON.stringify(s, null, 2));
};

export const readStore = async (): Promise<Store> => {
  if (inVercel) {
    // Serverless memory fallback (resets on cold start). For production, swap to a KV/DB.
    // @ts-ignore
    global.__MEM = global.__MEM || { knownItems: [], titles: [] };
    // @ts-ignore
    return global.__MEM;
  }
  return readFileStore();
};

export const writeStore = async (s: Store) => {
  if (inVercel) {
    // @ts-ignore
    global.__MEM = s;
    return;
  }
  return writeFileStore(s);
};
