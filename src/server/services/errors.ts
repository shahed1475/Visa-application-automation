export class PortalNotFoundError extends Error {
  constructor(public readonly portalId: string) {
    super(`Portal not found: ${portalId}`);
    this.name = 'PortalNotFoundError';
  }
}

export class PortalDisabledError extends Error {
  constructor(public readonly portalId: string) {
    super(`Portal is disabled: ${portalId}`);
    this.name = 'PortalDisabledError';
  }
}
