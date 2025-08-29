import { Contract } from '@algorandfoundation/algorand-typescript'

export class MintPreset extends Contract {
  public hello(name: string): string {
    return `Hello, ${name}`
  }
}
