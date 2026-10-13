import { LocalStorage, OAuth } from "@raycast/api";

export default async function Command() {
  const result: Record<string, unknown> = {};
  try {
    const client = new OAuth.PKCEClient({
      redirectMethod: OAuth.RedirectMethod.Web,
      providerName: "Test Provider",
      providerId: "test",
    });
    const request = await client.authorizationRequest({
      endpoint: "https://provider.example/authorize",
      clientId: "client-123",
      scope: "test-scope",
    });
    result.url = request.toURL();
    await LocalStorage.setItem("oauth-probe-step", "before-authorize");
    const response = await client.authorize(request);
    await LocalStorage.setItem("oauth-probe-step", "after-authorize");
    await client.setTokens({ access_token: "at-123", refresh_token: "rt-456", expires_in: 3600 });
    const tokens = await client.getTokens();
    result.authorizationCode = response.authorizationCode;
    result.accessToken = tokens?.accessToken;
    result.refreshToken = tokens?.refreshToken;
    result.expired = tokens ? tokens.isExpired() : null;
    await client.removeTokens();
    result.removed = (await client.getTokens()) === undefined;
    result.ok = true;
  } catch (error) {
    result.ok = false;
    result.error = error instanceof Error ? error.message : String(error);
    result.stack = error instanceof Error ? error.stack : undefined;
  }
  await LocalStorage.setItem("oauth-probe-result", JSON.stringify(result));
}
