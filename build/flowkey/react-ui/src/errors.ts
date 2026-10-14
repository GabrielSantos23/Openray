export class ReactUiError extends Error {
  readonly code = 'invalidTree';

  constructor(message: string) {
    super(message);
    this.name = 'ReactUiError';
  }
}
