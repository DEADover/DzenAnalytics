import { test, expect, connectZen } from "./harness";

test("выдуманный аккаунт подключается и лента заполняется", async ({ page, zen }) => {
  await connectZen(page, "/transactions");
  expect(zen.pulls).toBeGreaterThan(0);
  await expect(page.getByText("Пятёрочка").first()).toBeVisible();
});
