export interface KeyValuesObject {
  [key: string]: string | KeyValuesObject;
}
const TokenKind = { Text: "text", Open: "open", Close: "close", Bare: "bare" } as const;
interface Token {
  kind: (typeof TokenKind)[keyof typeof TokenKind];
  value: string;
}

// Steam manifests use a small data-only subset of Valve KeyValues. Directives,
// conditions and duplicate keys are rejected rather than interpreted as I/O.
export class KeyValuesParser {
  private readonly source: string;
  private position = 0;
  private tokens = 0;

  constructor(source: string) {
    this.source = source.replace(/^\uFEFF/, "");
    if (source.length > 1024 * 1024) {
      throw new Error("KeyValues byte limit exceeded");
    }
  }

  parse(): KeyValuesObject {
    const result = this.object(0, false);
    if (this.token() !== undefined) {
      throw new Error("Unexpected trailing KeyValues token");
    }
    return result;
  }

  private object(depth: number, nested: boolean): KeyValuesObject {
    if (depth > 16) {
      throw new Error("KeyValues nesting limit exceeded");
    }
    const result: KeyValuesObject = Object.create(null);
    while (true) {
      const key = this.token();
      if (key === undefined) {
        if (nested) {
          throw new Error("Unclosed KeyValues object");
        }
        return result;
      }
      if (key.kind === TokenKind.Close) {
        if (!nested) {
          throw new Error("Unexpected KeyValues closing brace");
        }
        return result;
      }
      if (
        key.kind === TokenKind.Open ||
        (key.kind === TokenKind.Bare && (key.value.startsWith("#") || key.value.startsWith("[")))
      ) {
        throw new Error("Unsupported KeyValues directive or key");
      }
      if (Object.hasOwn(result, key.value)) {
        throw new Error(`Duplicate KeyValues key: ${key.value}`);
      }
      const value = this.token();
      if (value === undefined || value.kind === TokenKind.Close) {
        throw new Error("Missing KeyValues value");
      }
      if (
        value.kind === TokenKind.Bare &&
        (value.value.startsWith("#") || value.value.startsWith("["))
      ) {
        throw new Error("Unsupported KeyValues directive or condition");
      }
      result[key.value] =
        value.kind === TokenKind.Open ? this.object(depth + 1, true) : value.value;
    }
  }

  private token(): Token | undefined {
    while (this.position < this.source.length) {
      const character = this.source[this.position]!;
      if (/\s/.test(character)) {
        this.position++;
      } else if (this.source.startsWith("//", this.position)) {
        const newline = this.source.indexOf("\n", this.position);
        this.position = newline < 0 ? this.source.length : newline + 1;
      } else {
        break;
      }
    }
    if (this.position >= this.source.length) {
      return undefined;
    }
    if (++this.tokens > 32_768) {
      throw new Error("KeyValues token limit exceeded");
    }
    const start = this.source[this.position++]!;
    if (start === "{" || start === "}") {
      return { kind: start === "{" ? TokenKind.Open : TokenKind.Close, value: start };
    }
    let value = "";
    if (start === '"') {
      while (this.position < this.source.length) {
        const character = this.source[this.position++]!;
        if (character === '"') {
          return { kind: TokenKind.Text, value };
        }
        if (character === "\\") {
          const escaped = this.source[this.position++];
          if (escaped === undefined) {
            throw new Error("Unclosed KeyValues escape");
          }
          if (escaped === "\\" || escaped === '"') {
            value += escaped;
          } else if (escaped === "n") {
            value += "\n";
          } else if (escaped === "t") {
            value += "\t";
          } else if (escaped === "r") {
            value += "\r";
          } else {
            throw new Error("Unsupported KeyValues escape");
          }
        } else {
          if (character === "\0") {
            throw new Error("Invalid KeyValues null character");
          }
          value += character;
        }
        if (value.length > 4096) {
          throw new Error("KeyValues token length limit exceeded");
        }
      }
      throw new Error("Unclosed KeyValues string");
    }
    value = start;
    while (this.position < this.source.length && !/[\s{}]/.test(this.source[this.position]!)) {
      value += this.source[this.position++];
      if (value.length > 4096) {
        throw new Error("KeyValues token length limit exceeded");
      }
    }
    return { kind: TokenKind.Bare, value };
  }
}
