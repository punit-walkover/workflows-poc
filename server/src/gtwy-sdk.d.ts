// gtwy-sdk ships no types; the POC only uses agent/version/chat (see ticket0-b/src/gtwy/gtwy-sdk.d.ts for the fuller shape).
declare module 'gtwy-sdk' {
  export class Gtwy {
    constructor(opts: Record<string, unknown>);
    agent: any;
    version: any;
    chat: any;
  }
}
