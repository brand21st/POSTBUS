import { formatLoginBlock, TokenManager, type LoginResult } from "./token-manager";

export { formatLoginBlock };

export async function runLoginTest(manager: TokenManager): Promise<LoginResult> {
  const result = await manager.authenticateCustomer();
  console.log(formatLoginBlock(result));
  console.log("");
  return result;
}

export async function runRefreshTest(manager: TokenManager): Promise<LoginResult> {
  const result = await manager.refreshAccessToken();
  console.log(formatLoginBlock(result, "REFRESH TOKEN TEST"));
  console.log("");
  return result;
}
