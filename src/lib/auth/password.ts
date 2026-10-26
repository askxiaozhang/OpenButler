import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  type ScryptOptions,
} from "node:crypto";
import { promisify } from "node:util";

/**
 * `promisify` 面对重载函数会挑错签名 —— node:crypto 的 scrypt 有 3 参和 4 参两个
 * 重载，推断结果只接受 3 个参数，传 options 就报 TS2554。这里显式断言成我们要的
 * 那个重载。返回值也顺手收窄成 Buffer（promisify 的推断给的是 `unknown`）。
 */
const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>;

/**
 * 密码哈希。用 Node 内置的 scrypt，零依赖。
 *
 * 为什么不用 bcrypt：bcrypt 的抗暴力优势来自可调工作因子，而 scrypt 同样可调，
 * 且是内置实现 —— 纯 JS 的 bcryptjs 会慢一个数量级，而 node-gyp 版的 bcrypt
 * 会给 Vercel 构建引入原生编译风险。一个 2-5 人的家庭应用不需要更强的方案。
 *
 * 存储格式：`scrypt$N$r$p$saltB64$hashB64`
 * 把参数写进哈希串，将来调高 N 时旧密码仍然可以验证（验证时从串里读参数）。
 */

const N = 16_384; // CPU/内存开销因子，必须是 2 的幂
const R = 8; // 块大小
const P = 1; // 并行度
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;

/** scrypt 的内存上限。默认值是 32MB，而 N=16384,r=8 需要约 128*N*r = 16MB，
 *  加上 Node 的开销会顶到默认上限，必须显式放宽，否则抛 ERR_CRYPTO_INVALID_SCRYPT_PARAMS。 */
const MAX_MEM = 64 * 1024 * 1024;

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derived = await scrypt(plain.normalize("NFKC"), salt, KEY_LENGTH, {
    N,
    r: R,
    p: P,
    maxmem: MAX_MEM,
  });

  return [
    "scrypt",
    N,
    R,
    P,
    salt.toString("base64"),
    derived.toString("base64"),
  ].join("$");
}

/**
 * 校验密码。
 *
 * 任何格式异常都返回 false 而不是抛错 —— 数据库里出现一条脏数据不应该
 * 让登录接口 500，那会把「密码错误」和「服务故障」混在一起，徒增排查难度。
 */
export async function verifyPassword(
  plain: string,
  stored: string,
): Promise<boolean> {
  try {
    const parts = stored.split("$");
    if (parts.length !== 6 || parts[0] !== "scrypt") return false;

    const n = Number(parts[1]);
    const r = Number(parts[2]);
    const p = Number(parts[3]);
    if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) {
      return false;
    }

    const salt = Buffer.from(parts[4], "base64");
    const expected = Buffer.from(parts[5], "base64");
    if (salt.length === 0 || expected.length === 0) return false;

    const actual = await scrypt(plain.normalize("NFKC"), salt, expected.length, {
      N: n,
      r,
      p,
      maxmem: MAX_MEM,
    });

    // 必须用定时安全比较：普通的 === 会在第一个不同的字节处短路返回，
    // 泄露「猜对了前几个字节」的时序信息。
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}