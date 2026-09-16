declare module "cloudflare:workers" {
  // Required module augmentation for the Cloudflare Vitest runtime bindings.
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface ProvidedEnv extends Env {}
}
