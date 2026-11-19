import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderWithIntl } from "@/components/test-utils/renderWithIntl";
import { FsrsOptimiserPanel } from "@/components/settings/FsrsOptimiserPanel";
import { syntheticGradeLog } from "@/lib/srs/syntheticGradeLog";
import { gradeLogToOptimizerItems, OPTIMIZER_COOLDOWN_MS } from "@/lib/srs/optimizer";
import { OptimiserError } from "@/lib/srs/optimiser/runInWorker";
import { SUPPORTED_LOCALES } from "@/i18n/locales";
import ja from "@/messages/ja.json";
import zhHans from "@/messages/zh-Hans.json";
import zhHant from "@/messages/zh-Hant.json";

const auth = vi.hoisted(() => ({
  value: { user: null as { id: string } | null, loading: false, supabase: null as object | null },
}));
const superuser = vi.hoisted(() => ({ anyFlagOn: false }));
const mocks = vi.hoisted(() => ({
  pullGradeLog: vi.fn(),
  pullSettings: vi.fn(),
  pushSettings: vi.fn(),
  loadSettings: vi.fn(),
  saveSettings: vi.fn(),
  isOptimiserSupported: vi.fn(),
  runOptimiserInWorker: vi.fn(),
}));

vi.mock("@/lib/auth/AuthContext", () => ({ useAuth: () => auth.value }));
vi.mock("@/lib/superuser/SuperuserContext", () => ({
  useSuperuser: () => ({ anyFlagOn: superuser.anyFlagOn }),
}));
vi.mock("@/lib/sync/gradeLog", () => ({ pullGradeLog: mocks.pullGradeLog }));
vi.mock("@/lib/sync/settings", () => ({
  pullSettings: mocks.pullSettings,
  pushSettings: mocks.pushSettings,
}));
vi.mock("@/lib/settings/persistence", () => ({
  loadSettings: mocks.loadSettings,
  saveSettings: mocks.saveSettings,
}));
vi.mock("@/lib/srs/optimiser/runInWorker", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/srs/optimiser/runInWorker")>()),
  isOptimiserSupported: mocks.isOptimiserSupported,
  runOptimiserInWorker: mocks.runOptimiserInWorker,
}));

const CLIENT = { fake: "client" };
const USER = { id: "user-1" };
const LOG = syntheticGradeLog({ days: 30, newPerDay: 8 });
const WEIGHTS = Array.from({ length: 21 }, (_, i) => i / 10);
const daysAgo = (d: number) => new Date(Date.now() - d * 24 * 60 * 60 * 1000).toISOString();

function signIn() {
  auth.value = { user: USER, loading: false, supabase: CLIENT };
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.value = { user: null, loading: false, supabase: CLIENT };
  superuser.anyFlagOn = false;
  mocks.isOptimiserSupported.mockReturnValue(true);
  mocks.pullGradeLog.mockResolvedValue(LOG);
  mocks.pullSettings.mockResolvedValue({});
  mocks.pushSettings.mockResolvedValue(true);
  mocks.loadSettings.mockReturnValue({ retentionTarget: 0.9 });
  mocks.runOptimiserInWorker.mockResolvedValue(WEIGHTS);
});

describe("FsrsOptimiserPanel states", () => {
  it("shows loading while auth resolves", () => {
    auth.value = { user: null, loading: true, supabase: CLIENT };
    renderWithIntl(<FsrsOptimiserPanel />);
    expect(screen.getByText("Loading your reviews…")).toBeInTheDocument();
  });

  it("guest: signed-in only, and loads nothing", () => {
    renderWithIntl(<FsrsOptimiserPanel />);
    expect(screen.getByTestId("fsrs-optimiser-signed-out")).toHaveTextContent(/Sign in to personalise/);
    expect(mocks.pullGradeLog).not.toHaveBeenCalled();
  });

  it("superuser flag on: paused, and loads nothing", () => {
    signIn();
    superuser.anyFlagOn = true;
    renderWithIntl(<FsrsOptimiserPanel />);
    expect(screen.getByTestId("fsrs-optimiser-paused")).toBeInTheDocument();
    expect(mocks.pullGradeLog).not.toHaveBeenCalled();
  });

  it("no cross-origin isolation or threads: not supported in this browser", () => {
    signIn();
    mocks.isOptimiserSupported.mockReturnValue(false);
    renderWithIntl(<FsrsOptimiserPanel />);
    expect(screen.getByTestId("fsrs-optimiser-unsupported")).toHaveTextContent(
      "This browser can't run the optimiser.",
    );
    expect(mocks.pullGradeLog).not.toHaveBeenCalled();
  });

  it("grade log fails to load: error with a working retry", async () => {
    signIn();
    mocks.pullGradeLog.mockResolvedValueOnce(null);
    renderWithIntl(<FsrsOptimiserPanel />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load your reviews.");
    expect(mocks.pullGradeLog).toHaveBeenCalledWith(CLIENT, USER.id);
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByTestId("fsrs-optimiser-run")).toBeInTheDocument();
  });

  it("fewer than the minimum reviews: not enough reviews, with the count", async () => {
    signIn();
    mocks.pullGradeLog.mockResolvedValueOnce(LOG.slice(0, 50));
    renderWithIntl(<FsrsOptimiserPanel />);
    expect(await screen.findByTestId("fsrs-optimiser-not-enough")).toHaveTextContent(
      /reviews the optimiser can use\. It needs about 200\./,
    );
    expect(screen.queryByTestId("fsrs-optimiser-run")).toBeNull();
  });

  it("cooldown from this device's last run", async () => {
    signIn();
    mocks.loadSettings.mockReturnValue({ retentionTarget: 0.9, fsrsWeightsOptimizedAt: daysAgo(2) });
    renderWithIntl(<FsrsOptimiserPanel />);
    expect(await screen.findByTestId("fsrs-optimiser-cooldown")).toHaveTextContent(
      "Next optimisation in 5 days",
    );
    expect(screen.getByTestId("fsrs-optimiser-last-run")).toHaveTextContent(/Last optimised:/);
    expect(screen.queryByTestId("fsrs-optimiser-run")).toBeNull();
  });

  it("cooldown from another device's run (the cloud copy is newer)", async () => {
    signIn();
    mocks.loadSettings.mockReturnValue({ retentionTarget: 0.9, fsrsWeightsOptimizedAt: daysAgo(30) });
    mocks.pullSettings.mockResolvedValueOnce({ fsrsWeightsOptimizedAt: daysAgo(6) });
    renderWithIntl(<FsrsOptimiserPanel />);
    expect(await screen.findByTestId("fsrs-optimiser-cooldown")).toHaveTextContent(
      "Next optimisation in 1 day",
    );
  });

  it("runs after the cooldown has passed", async () => {
    signIn();
    mocks.loadSettings.mockReturnValue({
      retentionTarget: 0.9,
      fsrsWeightsOptimizedAt: new Date(Date.now() - OPTIMIZER_COOLDOWN_MS - 1000).toISOString(),
    });
    renderWithIntl(<FsrsOptimiserPanel />);
    expect(await screen.findByTestId("fsrs-optimiser-run")).toHaveTextContent("Optimise now");
  });
});

describe("FsrsOptimiserPanel run", () => {
  it("fits the review-prefix items, pushes the weights, then saves them locally", async () => {
    signIn();
    let progress: ((current: number, total: number) => void) | undefined;
    let finish: (weights: number[]) => void = () => {};
    mocks.runOptimiserInWorker.mockImplementationOnce((_items, options) => {
      progress = options.onProgress;
      return new Promise((resolve) => (finish = resolve));
    });
    renderWithIntl(<FsrsOptimiserPanel />);
    await userEvent.click(await screen.findByTestId("fsrs-optimiser-run"));

    expect(screen.getByTestId("fsrs-optimiser-running")).toHaveTextContent("Fitting your weights");
    expect(mocks.runOptimiserInWorker.mock.calls[0][0]).toEqual(gradeLogToOptimizerItems(LOG));
    progress?.(30, 120);
    expect(await screen.findByText("25% done")).toBeInTheDocument();

    finish(WEIGHTS);
    expect(await screen.findByTestId("fsrs-optimiser-success")).toBeInTheDocument();
    const patch = mocks.pushSettings.mock.calls[0][2];
    expect(mocks.pushSettings).toHaveBeenCalledWith(CLIENT, USER.id, {
      fsrsWeights: WEIGHTS,
      fsrsWeightsOptimizedAt: expect.any(String),
    });
    expect(mocks.saveSettings).toHaveBeenCalledWith({ retentionTarget: 0.9, ...patch });
  });

  it("NotEnoughData from the binding: keep-studying message, nothing saved", async () => {
    signIn();
    mocks.runOptimiserInWorker.mockRejectedValueOnce(
      new OptimiserError("not_enough_data", "compute_parameters failed: NotEnoughData"),
    );
    renderWithIntl(<FsrsOptimiserPanel />);
    await userEvent.click(await screen.findByTestId("fsrs-optimiser-run"));
    expect(await screen.findByTestId("fsrs-optimiser-error")).toHaveTextContent(
      "There isn't enough variety in your reviews yet.",
    );
    expect(mocks.pushSettings).not.toHaveBeenCalled();
    expect(mocks.saveSettings).not.toHaveBeenCalled();
  });

  it("any other failure: generic error with the detail, and a retry button", async () => {
    signIn();
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.runOptimiserInWorker.mockRejectedValueOnce(new OptimiserError("failed", "wasm fetch failed (404)"));
    renderWithIntl(<FsrsOptimiserPanel />);
    await userEvent.click(await screen.findByTestId("fsrs-optimiser-run"));
    const error = await screen.findByTestId("fsrs-optimiser-error");
    expect(error).toHaveTextContent("Couldn't optimise. Try again later.");
    expect(error).toHaveTextContent("Details: wasm fetch failed (404)");
    expect(screen.getByTestId("fsrs-optimiser-run")).toHaveTextContent("Try again");
  });

  it("save fails: error, and the weights are not kept locally", async () => {
    signIn();
    mocks.pushSettings.mockResolvedValueOnce(false);
    renderWithIntl(<FsrsOptimiserPanel />);
    await userEvent.click(await screen.findByTestId("fsrs-optimiser-run"));
    expect(await screen.findByTestId("fsrs-optimiser-error")).toHaveTextContent(
      "The weights were fitted but couldn't be saved.",
    );
    expect(mocks.saveSettings).not.toHaveBeenCalled();
  });

  it("a superuser flag turned on during the fit: no cloud or local write", async () => {
    signIn();
    let finish: (weights: number[]) => void = () => {};
    mocks.runOptimiserInWorker.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    const { rerender } = renderWithIntl(<FsrsOptimiserPanel />);
    await userEvent.click(await screen.findByTestId("fsrs-optimiser-run"));
    superuser.anyFlagOn = true;
    rerender(<FsrsOptimiserPanel />);
    finish(WEIGHTS);
    expect(await screen.findByTestId("fsrs-optimiser-paused")).toBeInTheDocument();
    await waitFor(() => expect(mocks.runOptimiserInWorker).toHaveBeenCalled());
    expect(mocks.pushSettings).not.toHaveBeenCalled();
    expect(mocks.saveSettings).not.toHaveBeenCalled();
  });
});

describe("FsrsOptimiserPanel locale coverage", () => {
  const catalogues = { ja, "zh-Hans": zhHans, "zh-Hant": zhHant } as const;
  const others = SUPPORTED_LOCALES.filter((l) => l !== "en");

  it.each(others)("%s: heading and signed-out state are translated", (locale) => {
    const m = catalogues[locale as keyof typeof catalogues].settings.optimiser;
    renderWithIntl(<FsrsOptimiserPanel />, { locale });
    expect(screen.getByRole("heading", { level: 1, name: m.heading })).toBeInTheDocument();
    expect(screen.getByTestId("fsrs-optimiser-signed-out")).toHaveTextContent(m.page.signedOut);
    expect(screen.getByRole("link", { name: m.page.backToSettings })).toHaveAttribute("href", "/settings");
  });

  it.each(others)("%s: unsupported and ready states are translated", async (locale) => {
    const m = catalogues[locale as keyof typeof catalogues].settings.optimiser;
    signIn();
    mocks.isOptimiserSupported.mockReturnValue(false);
    const { unmount } = renderWithIntl(<FsrsOptimiserPanel />, { locale });
    expect(screen.getByTestId("fsrs-optimiser-unsupported")).toHaveTextContent(m.page.unsupported);
    unmount();
    mocks.isOptimiserSupported.mockReturnValue(true);
    renderWithIntl(<FsrsOptimiserPanel />, { locale });
    expect(await screen.findByTestId("fsrs-optimiser-run")).toHaveTextContent(m.optimiseNow);
  });
});
