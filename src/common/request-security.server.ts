export function applicationOrigin(request: Request): string {
    return new URL(process.env.APP_URL ?? request.url).origin;
}
