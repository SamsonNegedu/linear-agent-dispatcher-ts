export class AdapterRegistry<T extends { readonly provider: string }> {
  private readonly adapters = new Map<string, T>();

  register(adapter: T): void {
    this.adapters.set(adapter.provider, adapter);
  }

  get(provider: string): T | undefined {
    return this.adapters.get(provider);
  }

  getOrThrow(provider: string): T {
    const adapter = this.adapters.get(provider);
    if (!adapter) {
      throw new Error(`No adapter registered for provider "${provider}"`);
    }
    return adapter;
  }
}
