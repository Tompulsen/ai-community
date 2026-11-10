// ANSI color codes for terminal output
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
};

export class MCPClientLogger {
  private readonly prefix: string;

  constructor(prefix: string = "章鱼公益平台 MCP Client") {
    this.prefix = prefix;
  }

  error(message: any) {
    this.print("error", colors.red, message);
  }

  warn(message: any) {
    this.print("warn", colors.yellow, message);
  }

  /**
   * Format message to string, if message is object, convert to JSON string
   */
  private formatMessage(message: any): string {
    return typeof message === "object"
      ? JSON.stringify(message, null, 2)
      : message;
  }

  /**
   * Print formatted message to console
   */
  private print(level: "warn" | "error", color: string, message: any) {
    const formattedMessage = this.formatMessage(message);
    const logMessage = `${color}${colors.bright}[${this.prefix}]${colors.reset} ${formattedMessage}`;

    if (level === "error") console.error(logMessage);
    else console.warn(logMessage);
  }
}
