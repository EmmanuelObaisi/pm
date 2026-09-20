import { expect, test, type Page } from "@playwright/test";

/**
 * Each test registers its own account, so runs never collide on a shared
 * database and no cleanup is needed between them.
 */
const uniqueName = (prefix: string) =>
  `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const PASSWORD = "password123";

const register = async (page: Page, username = uniqueName("u")) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Need an account/ }).click();
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Your boards")).toBeVisible();
  return username;
};

const openBoard = async (page: Page, name: string) => {
  await page.getByText(name, { exact: true }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
};

const createBoard = async (page: Page, name: string) => {
  await page.getByRole("button", { name: "New board" }).click();
  await page.getByLabel("Name").fill(name);
  await page.getByRole("button", { name: "Create board" }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
};

const addCard = async (page: Page, column: string, title: string) => {
  const region = page.getByRole("region", { name: `Column ${column}` });
  await region.getByRole("button", { name: "Add card" }).click();
  await page.getByLabel(`New card in ${column}`).fill(title);
  await region.getByRole("button", { name: "Add", exact: true }).click();
  await expect(region.getByText(title)).toBeVisible();
};

test("register, then sign out and back in", async ({ page }) => {
  const username = await register(page);

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();

  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Your boards")).toBeVisible();
});

test("a reload keeps the user signed in", async ({ page }) => {
  await register(page);
  await page.reload();
  await expect(page.getByText("Your boards")).toBeVisible();
});

test("a wrong password is rejected", async ({ page }) => {
  const username = await register(page);
  await page.getByRole("button", { name: "Sign out" }).click();

  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill("not-the-password");
  await page.getByRole("button", { name: "Sign in" }).click();

  // Next's route announcer is also role="alert", so match the message itself.
  await expect(page.getByText("Invalid username or password")).toBeVisible();
});

test("registration starts the user with one board", async ({ page }) => {
  await register(page);
  await expect(page.getByText("My First Board")).toBeVisible();
});

test("create a board and work on a card", async ({ page }) => {
  await register(page);
  await createBoard(page, "Launch plan");

  await addCard(page, "Backlog", "Write the announcement");

  await page.getByRole("button", { name: "Open card Write the announcement" }).click();
  const drawer = page.getByRole("dialog", { name: "Card Write the announcement" });
  await expect(drawer).toBeVisible();

  await drawer.getByLabel("Description").fill("Blog post plus the changelog");
  await drawer.getByLabel("Priority").selectOption("urgent");
  await drawer.getByLabel("Due date").fill("2026-12-24");

  await drawer.getByLabel("New checklist item").fill("Draft the copy");
  await drawer.getByRole("button", { name: "Add", exact: true }).click();
  await expect(drawer.getByText("Checklist (0/1)")).toBeVisible();

  await drawer.getByLabel("New comment").fill("Ready for review");
  await drawer.getByRole("button", { name: "Post" }).click();
  await expect(drawer.getByText("Ready for review")).toBeVisible();

  await drawer.getByRole("button", { name: "Close" }).click();

  const card = page.getByRole("button", { name: "Open card Write the announcement" });
  await expect(card).toContainText("urgent");
  await expect(card).toContainText("0/1");
  await expect(card).toContainText("1 comments");
});

test("the card survives a reload", async ({ page }) => {
  await register(page);
  await createBoard(page, "Persistence");
  await addCard(page, "Backlog", "Still here");

  await page.reload();
  await openBoard(page, "Persistence");
  await expect(page.getByText("Still here")).toBeVisible();
});

test("drag a card to another column", async ({ page }) => {
  await register(page);
  await createBoard(page, "Dragging");
  await addCard(page, "Backlog", "Move me");

  const card = page.getByRole("button", { name: "Open card Move me" });
  const target = page.getByRole("region", { name: "Column In Progress" });

  const from = await card.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) {
    throw new Error("card or target column has no layout");
  }

  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  // dnd-kit needs movement past its activation distance, in several steps.
  await page.mouse.move(from.x + from.width / 2 + 20, from.y + from.height / 2, {
    steps: 5,
  });
  await page.mouse.move(to.x + to.width / 2, to.y + 80, { steps: 10 });
  await page.mouse.up();

  await expect(target.getByText("Move me")).toBeVisible();

  await page.reload();
  await openBoard(page, "Dragging");
  await expect(
    page.getByRole("region", { name: "Column In Progress" }).getByText("Move me")
  ).toBeVisible();
});

test("archive a card and restore it", async ({ page }) => {
  await register(page);
  await createBoard(page, "Archiving");
  await addCard(page, "Backlog", "Put me away");

  await page.getByRole("button", { name: "Open card Put me away" }).click();
  const drawer = page.getByRole("dialog", { name: "Card Put me away" });
  await drawer.getByRole("button", { name: "Archive" }).click();
  await expect(page.getByText("Put me away")).toHaveCount(0);

  await page.getByRole("button", { name: "Details" }).click();
  const sidebar = page.getByRole("complementary", { name: "Board details" });
  await sidebar.getByRole("button", { name: "Archive" }).click();
  await expect(sidebar.getByText("Put me away")).toBeVisible();

  await sidebar.getByRole("button", { name: "Restore Put me away" }).click();
  await expect(
    page.getByRole("region", { name: "Column Backlog" }).getByText("Put me away")
  ).toBeVisible();
});

test("add and delete a column", async ({ page }) => {
  await register(page);
  await createBoard(page, "Columns");

  await page.getByRole("button", { name: "Add column" }).click();
  await page.getByLabel("New column title").fill("Blocked");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("region", { name: "Column Blocked" })).toBeVisible();

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete column Blocked" }).click();
  await expect(page.getByRole("region", { name: "Column Blocked" })).toHaveCount(0);
});

test("search narrows the board", async ({ page }) => {
  await register(page);
  await createBoard(page, "Filtering");
  await addCard(page, "Backlog", "Alpha task");
  await addCard(page, "Backlog", "Beta task");

  await page.getByLabel("Search cards").fill("Alpha");
  await expect(page.getByText("Alpha task")).toBeVisible();
  await expect(page.getByText("Beta task")).toHaveCount(0);

  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page.getByText("Beta task")).toBeVisible();
});

test("share a board with another user as a viewer", async ({ page, browser }) => {
  const viewer = uniqueName("v");
  const viewerContext = await browser.newContext();
  const viewerPage = await viewerContext.newPage();
  await register(viewerPage, viewer);

  await register(page);
  await createBoard(page, "Shared board");
  await addCard(page, "Backlog", "Owner's card");

  await page.getByRole("button", { name: "Details" }).click();
  await page.getByRole("button", { name: "Members" }).click();
  await page.getByLabel("Username to add").fill(viewer);
  await page.getByLabel("Role for the new member").selectOption("viewer");
  await page.getByRole("button", { name: "Add member" }).click();
  await expect(page.getByText(viewer)).toBeVisible();

  await viewerPage.reload();
  await expect(viewerPage.getByText("Shared board")).toBeVisible();
  await viewerPage.getByText("Shared board").click();

  await expect(viewerPage.getByText("Owner's card")).toBeVisible();
  await expect(viewerPage.getByText(/you are viewer/)).toBeVisible();
  // A viewer gets no editing controls.
  await expect(viewerPage.getByRole("button", { name: "Add card" })).toHaveCount(0);
  await expect(viewerPage.getByRole("button", { name: "Add column" })).toHaveCount(0);

  await viewerContext.close();
});

test("the board list shows counts and archiving works", async ({ page }) => {
  await register(page);
  await createBoard(page, "Countable");
  await addCard(page, "Backlog", "One");
  await addCard(page, "Backlog", "Two");

  await page.getByRole("button", { name: "Boards" }).click();
  const card = page.locator("li", { hasText: "Countable" });
  await expect(card).toContainText("2 cards");

  await card.getByRole("button", { name: "Archive" }).click();
  await expect(page.getByText("Countable")).toHaveCount(0);

  await page.getByLabel("Show archived").check();
  await expect(page.getByText("Countable")).toBeVisible();
});

test("update the profile from the account page", async ({ page }) => {
  await register(page);

  await page.getByRole("button", { name: "Account" }).click();
  await page.getByLabel("Full name").fill("Real Name");
  await page.getByRole("button", { name: "Save profile" }).click();

  await expect(page.getByText("Profile saved")).toBeVisible();
  await expect(page.locator("nav")).toContainText("Real Name");
});

test("change the password and sign in with the new one", async ({ page }) => {
  const username = await register(page);

  await page.getByRole("button", { name: "Account" }).click();
  await page.getByLabel("Current password").fill(PASSWORD);
  await page.getByLabel("New password").fill("brandnew123");
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page.getByText("Password changed")).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill("brandnew123");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByText("Your boards")).toBeVisible();
});
