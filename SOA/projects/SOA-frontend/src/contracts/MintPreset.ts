/*
 * Temporary stub for MintPreset contract factory used by the template AppCalls component.
 * The real contract will be implemented in v2 – this prevents Vite import errors during MVP work.
 */

export interface DummyHelloResponse { return: string }

export class MintPresetFactory {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(_args: any) {}

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async deploy(_opts: any): Promise<{ appClient: { send: { hello: (args: unknown) => Promise<DummyHelloResponse> } } }> {
    return {
      appClient: {
        send: {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          hello: async (_args) => ({ return: 'hello-world (stub)' }),
        },
      },
    }
  }
}
