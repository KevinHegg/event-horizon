declare module '*.mjs' {
  const defaultExport: (request: Request, context?: unknown) => Promise<Response>;
  export default defaultExport;
}
