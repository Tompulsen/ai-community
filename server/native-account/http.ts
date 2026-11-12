export class AccountRequest extends Request {
  get nextUrl() { return new URL(this.url) }
  get cookies() {
    return {
      get: (name: string): { value: string } | undefined => {
        const values = (this.headers.get("cookie") || "").split(";").map(value => value.trim())
          .filter(value => value.startsWith(`${name}=`))
        if (values.length !== 1) return undefined
        try { return { value: decodeURIComponent(values[0]!.slice(name.length + 1)) } }
        catch { return undefined }
      },
    }
  }
}

interface CookieOptions {
  httpOnly?: boolean
  secure?: boolean
  sameSite?: "lax" | "strict" | "none"
  path?: string
  maxAge?: number
}

export class AccountResponse extends Response {
  static override json(value: unknown, init: ResponseInit = {}) {
    const headers = new Headers(init.headers)
    headers.set("Content-Type", "application/json")
    return new AccountResponse(JSON.stringify(value), { ...init, headers })
  }
  get cookies() {
    return {
      set: (name: string, value: string, options: CookieOptions = {}) => {
        const parts = [`${encodeURIComponent(name)}=${encodeURIComponent(value)}`]
        if (options.path) parts.push(`Path=${options.path}`)
        if (options.httpOnly) parts.push("HttpOnly")
        if (options.secure) parts.push("Secure")
        if (options.sameSite) parts.push(`SameSite=${options.sameSite}`)
        if (options.maxAge !== undefined) parts.push(`Max-Age=${Math.floor(options.maxAge)}`)
        this.headers.append("Set-Cookie", parts.join("; "))
      },
    }
  }
}
