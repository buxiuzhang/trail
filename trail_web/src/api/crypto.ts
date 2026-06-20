/**
 * RSA 公钥加密/解密工具
 *
 * 使用 Web Crypto API 进行公钥加密（发送数据给后端）。
 * 使用纯 JS 大整数实现公钥解密（解密后端私钥加密的数据）。
 *
 * 流程：
 * - 前端 → 后端：公钥加密（Web Crypto API，RSA-OAEP）
 * - 后端 → 前端：私钥加密，前端公钥解密（纯 JS，PKCS#1 v1.5）
 */

const PUBLIC_KEY_CACHE_KEY = 'trail_public_key'

interface PublicKeyCache {
  publicKey: string
  expiresAt: number  // 过期时间戳（毫秒）
}

interface PublicKeyResponse {
  publicKey: string
  expiresAt: string  // ISO 8601 格式
}

/**
 * 获取公钥（优先从 localStorage 缓存，有效期 24 小时）
 */
export async function getPublicKey(): Promise<string> {
  try {
    const cached = localStorage.getItem(PUBLIC_KEY_CACHE_KEY)
    if (cached) {
      try {
        const data: PublicKeyCache = JSON.parse(cached)
        if (Date.now() < data.expiresAt) {
          return data.publicKey
        }
        localStorage.removeItem(PUBLIC_KEY_CACHE_KEY)
      } catch {
        localStorage.removeItem(PUBLIC_KEY_CACHE_KEY)
      }
    }
  } catch { /* storage blocked — skip cache */ }

  const response = await fetch('/api/crypto/public-key')
  if (!response.ok) {
    throw new Error('获取公钥失败')
  }
  const { publicKey, expiresAt }: PublicKeyResponse = await response.json()

  try {
    localStorage.setItem(PUBLIC_KEY_CACHE_KEY, JSON.stringify({
      publicKey,
      expiresAt: new Date(expiresAt).getTime()
    }))
  } catch { /* storage blocked — operate without cache */ }

  return publicKey
}

/**
 * PEM 转换为 CryptoKey（用于 Web Crypto API 加密）
 */
async function importPublicKey(pem: string): Promise<CryptoKey> {
  const base64 = pem
    .replace(/-----BEGIN PUBLIC KEY-----/, '')
    .replace(/-----END PUBLIC KEY-----/, '')
    .replace(/\s/g, '')

  const binary = Uint8Array.from(atob(base64), c => c.charCodeAt(0))

  return await window.crypto.subtle.importKey(
    'spki',
    binary,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['encrypt']
  )
}

/**
 * RSA 公钥加密（发送数据给后端）
 *
 * @param plaintext 要加密的明文（如 API Key）
 * @returns base64 编码的密文
 */
export async function rsaEncrypt(plaintext: string): Promise<string> {
  const pem = await getPublicKey()
  const publicKey = await importPublicKey(pem)

  const data = new TextEncoder().encode(plaintext)
  const encrypted = await window.crypto.subtle.encrypt(
    { name: 'RSA-OAEP' },
    publicKey,
    data
  )

  return btoa(String.fromCharCode(...new Uint8Array(encrypted)))
}

/**
 * RSA 公钥解密（解密后端私钥加密的数据）
 *
 * 后端使用私钥加密（PKCS#1 v1.5 padding），前端用公钥解密。
 * 由于 Web Crypto API 不支持公钥解密，使用纯 JS 大整数实现。
 *
 * @param encryptedBase64 base64 编码的密文
 * @returns 解密后的明文
 */
export async function rsaDecrypt(encryptedBase64: string): Promise<string> {
  if (!encryptedBase64) return ''

  const pem = await getPublicKey()

  // 解析 PEM 获取公钥参数 (n, e)
  const { n, e } = parsePublicKeyPem(pem)

  // 解码密文
  const encryptedBytes = Uint8Array.from(atob(encryptedBase64), c => c.charCodeAt(0))

  // RSA 解密：c^e mod n
  const c = bytesToBigInt(encryptedBytes)
  const m = modPow(c, e, n)

  // 转换为字节并移除 PKCS#1 v1.5 padding
  const decryptedBytes = bigIntToBytes(m, 256)
  const plaintext = removePKCS1v15Padding(decryptedBytes)

  return plaintext
}

/**
 * 解析 PEM 格式公钥，提取 n 和 e
 */
function parsePublicKeyPem(pem: string): { n: bigint; e: bigint } {
  const base64 = pem
    .replace(/-----BEGIN PUBLIC KEY-----/, '')
    .replace(/-----END PUBLIC KEY-----/, '')
    .replace(/\s/g, '')

  const der = Uint8Array.from(atob(base64), c => c.charCodeAt(0))

  // 解析 DER 格式
  // RSA 公钥 DER 结构：
  // SEQUENCE { SEQUENCE { OID, NULL }, BIT STRING { SEQUENCE { INTEGER n, INTEGER e } } }
  let offset = 0

  // 读取 SEQUENCE
  if (der[offset++] !== 0x30) throw new Error('无效的 DER 格式')
  const seqLen = readDerLength(der, offset)
  offset += seqLen.consumed

  // 读取 SEQUENCE (算法标识)
  if (der[offset++] !== 0x30) throw new Error('无效的 DER 格式')
  const algLen = readDerLength(der, offset)
  offset += algLen.consumed + algLen.value

  // 读取 BIT STRING
  if (der[offset++] !== 0x03) throw new Error('无效的 DER 格式')
  const bitStringLen = readDerLength(der, offset)
  offset += bitStringLen.consumed
  // 跳过 unused bits 字节
  offset++

  // 读取 SEQUENCE (公钥参数)
  if (der[offset++] !== 0x30) throw new Error('无效的 DER 格式')
  const keySeqLen = readDerLength(der, offset)
  offset += keySeqLen.consumed

  // 读取 INTEGER n (模数)
  if (der[offset++] !== 0x02) throw new Error('无效的 DER 格式')
  const nLen = readDerLength(der, offset)
  offset += nLen.consumed
  const nBytes = der.slice(offset, offset + nLen.value)
  offset += nLen.value

  // 读取 INTEGER e (公钥指数)
  if (der[offset++] !== 0x02) throw new Error('无效的 DER 格式')
  const eLen = readDerLength(der, offset)
  offset += eLen.consumed
  const eBytes = der.slice(offset, offset + eLen.value)

  return {
    n: bytesToBigInt(nBytes),
    e: bytesToBigInt(eBytes)
  }
}

/**
 * 读取 DER 长度
 */
function readDerLength(der: Uint8Array, offset: number): { value: number; consumed: number } {
  const firstByte = der[offset]
  if (firstByte < 0x80) {
    return { value: firstByte, consumed: 1 }
  } else {
    const numBytes = firstByte & 0x7f
    let value = 0
    for (let i = 1; i <= numBytes; i++) {
      value = (value << 8) | der[offset + i]
    }
    return { value, consumed: 1 + numBytes }
  }
}

/**
 * 字节数组转大整数
 */
function bytesToBigInt(bytes: Uint8Array): bigint {
  let result = BigInt(0)
  for (let i = 0; i < bytes.length; i++) {
    result = (result << BigInt(8)) | BigInt(bytes[i])
  }
  return result
}

/**
 * 大整数转字节数组
 */
function bigIntToBytes(num: bigint, length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  for (let i = length - 1; i >= 0; i--) {
    bytes[i] = Number(num & BigInt(0xff))
    num = num >> BigInt(8)
  }
  return bytes
}

/**
 * 模幂运算：base^exp mod mod
 */
function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = BigInt(1)
  base = base % mod

  while (exp > BigInt(0)) {
    if (exp & BigInt(1)) {
      result = (result * base) % mod
    }
    exp = exp >> BigInt(1)
    base = (base * base) % mod
  }

  return result
}

/**
 * 移除 PKCS#1 v1.5 padding
 *
 * 格式：0x00 0x02 [随机非零字节] 0x00 [数据]
 */
function removePKCS1v15Padding(bytes: Uint8Array): string {
  if (bytes[0] !== 0x00 || bytes[1] !== 0x02) {
    throw new Error('无效的 PKCS#1 v1.5 padding')
  }

  // 找到 0x00 分隔符
  let separatorIndex = 2
  while (separatorIndex < bytes.length && bytes[separatorIndex] !== 0x00) {
    separatorIndex++
  }

  if (separatorIndex >= bytes.length) {
    throw new Error('找不到 PKCS#1 v1.5 padding 分隔符')
  }

  // 提取数据部分
  const dataBytes = bytes.slice(separatorIndex + 1)
  return new TextDecoder().decode(dataBytes)
}

/**
 * 清除公钥缓存
 */
export function clearPublicKeyCache(): void {
  try { localStorage.removeItem(PUBLIC_KEY_CACHE_KEY) } catch { /* storage blocked */ }
}