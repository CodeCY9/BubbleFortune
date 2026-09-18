import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  createInitialPresentationState,
  applySnapshotToPresentation,
  commitBoxOpenAnimation,
} from '../src/utils/presentationManager';
import type { PublicSnapshot } from '../packages/protocol/src/types';

function createMockSnapshot(overrides: Partial<PublicSnapshot> = {}): PublicSnapshot {
  return {
    gameId: 'game_test_123',
    ruleVersion: 'classic-26-v1',
    phase: 'OPENING',
    stateVersion: 10,
    lastCommandSequence: 5,
    serverNow: 1700000000000,
    originalPlayerBoxId: 1,
    currentPlayerBoxId: 1,
    currentRound: 1,
    boxesToOpenThisRound: 1,
    totalOpenedBoxes: 5,
    unopenedCount: 21,
    boxes: Array.from({ length: 26 }, (_, i) => {
      const id = i + 1;
      if (id === 1) {
        return { id, status: 'selected' as const };
      }
      return { id, status: 'unopened' as const };
    }),
    currentOffer: null,
    deadlineTimestamp: 1700000030000,
    settlement: null,
    ...overrides,
  };
}

describe('Presentation Layer State & Suspense Control Tests', () => {
  it('1. 动画期间金额/报价不提前显示 (Opening suspense: amount, offer and phase held back during animation)', () => {
    const initialState = createInitialPresentationState(0);
    initialState.phase = 'OPEN_BOXES';
    initialState.playerBoxId = 1;
    initialState.boxes = initialState.boxes.map((b) =>
      b.id === 1 ? { ...b, isPlayerBox: true } : b
    );

    // Server snapshot where box 5 is newly opened with $500,000, and server enters OFFERING with $75,000 offer
    const serverSnapshot = createMockSnapshot({
      phase: 'OFFERING',
      currentOffer: {
        offerId: 'off_1',
        amount: 75000,
        expiresAt: 1700000030000,
      },
      boxes: initialState.boxes.map((b) => {
        if (b.id === 1) return { id: 1, status: 'selected' as const };
        if (b.id === 5) return { id: 5, status: 'opened' as const, revealedAmount: 500000 };
        return { id: b.id, status: 'unopened' as const };
      }),
    });

    const result = applySnapshotToPresentation(initialState, serverSnapshot, false);

    // Animation should be started for box 5
    assert.strictEqual(result.shouldAnimateBoxId, 5, 'Should trigger animation for box 5');
    assert.strictEqual(result.state.openingBoxId, 5, 'State openingBoxId should be 5');

    // Box 5 must NOT be marked as opened in presentation state during animation
    const box5 = result.state.boxes.find((b) => b.id === 5);
    assert.ok(box5, 'Box 5 must exist');
    assert.strictEqual(box5.isOpened, false, 'Box 5 isOpened must remain false during animation');

    // Revealed amount must NOT be eliminated on money ladder yet
    assert.strictEqual(
      result.state.eliminatedAmounts.has(500000),
      false,
      '500,000 must NOT be eliminated in ladder during opening'
    );

    // Banker offer must NOT be displayed yet
    assert.strictEqual(result.state.bankerOffer, 0, 'Banker offer must remain 0 during opening');

    // Presentation phase must remain in OPEN_BOXES, not advanced to BANKER_OFFER yet
    assert.strictEqual(
      result.state.phase,
      'OPEN_BOXES',
      'Phase must remain OPEN_BOXES while box is animating'
    );
  });

  it('2. 完成后解锁 (Unlocking after animation completes: box opened, ladder updated, offer revealed, unlocked)', () => {
    const initialState = createInitialPresentationState(0);
    initialState.phase = 'OPEN_BOXES';
    initialState.playerBoxId = 1;
    initialState.boxes = initialState.boxes.map((b) =>
      b.id === 1 ? { ...b, isPlayerBox: true } : b
    );

    const serverSnapshot = createMockSnapshot({
      phase: 'OFFERING',
      currentOffer: {
        offerId: 'off_1',
        amount: 75000,
        expiresAt: 1700000030000,
      },
      boxes: initialState.boxes.map((b) => {
        if (b.id === 1) return { id: 1, status: 'selected' as const };
        if (b.id === 5) return { id: 5, status: 'opened' as const, revealedAmount: 500000 };
        return { id: b.id, status: 'unopened' as const };
      }),
    });

    const { state: openingState } = applySnapshotToPresentation(initialState, serverSnapshot, false);
    assert.strictEqual(openingState.openingBoxId, 5);

    // Now animation completes
    const committedState = commitBoxOpenAnimation(openingState, 5, 0, serverSnapshot);

    // 1. openingBoxId unlocked
    assert.strictEqual(committedState.openingBoxId, null, 'openingBoxId should be reset to null');

    // 2. Box 5 is now opened with value
    const box5 = committedState.boxes.find((b) => b.id === 5);
    assert.ok(box5 && box5.isOpened, 'Box 5 must be opened');
    assert.strictEqual(box5.value, 500000, 'Box 5 value must be 500,000');

    // 3. Amount is now eliminated on ladder
    assert.strictEqual(
      committedState.eliminatedAmounts.has(500000),
      true,
      '500,000 must now be in eliminatedAmounts'
    );

    // 4. Banker offer is now active
    assert.strictEqual(committedState.bankerOffer, 75000, 'Banker offer must now be 75,000');
    assert.strictEqual(committedState.phase, 'BANKER_OFFER', 'Phase must now be BANKER_OFFER');
  });

  it('3. 重复snapshot不重播 (Duplicate snapshot does not replay animation)', () => {
    const initialState = createInitialPresentationState(0);
    initialState.phase = 'OPEN_BOXES';
    initialState.playerBoxId = 1;

    const serverSnapshot = createMockSnapshot({
      boxes: initialState.boxes.map((b) => {
        if (b.id === 1) return { id: 1, status: 'selected' as const };
        if (b.id === 5) return { id: 5, status: 'opened' as const, revealedAmount: 500000 };
        return { id: b.id, status: 'unopened' as const };
      }),
    });

    // First arrival: starts animation
    const firstResult = applySnapshotToPresentation(initialState, serverSnapshot, false);
    assert.strictEqual(firstResult.shouldAnimateBoxId, 5);
    assert.strictEqual(firstResult.state.openingBoxId, 5);

    // Duplicate snapshot arrives while box 5 is already opening
    const secondResult = applySnapshotToPresentation(firstResult.state, serverSnapshot, false);
    assert.strictEqual(
      secondResult.shouldAnimateBoxId,
      null,
      'Duplicate snapshot MUST NOT re-trigger animation'
    );
    assert.strictEqual(
      secondResult.state.openingBoxId,
      5,
      'openingBoxId should remain 5 without restarting'
    );
  });

  it('4. 旧game/旧callback忽略 (Stale callback from previous epoch or game is ignored)', () => {
    // Game in epoch 0 is opening box 5
    const epoch0State = createInitialPresentationState(0);
    epoch0State.openingBoxId = 5;
    epoch0State.pendingRevealAmount = 500000;

    // User restarts game: new presentation state is created with epoch 1
    const epoch1State = createInitialPresentationState(1);
    epoch1State.phase = 'CHOOSE_PLAYER_BOX';

    // A delayed animation callback from epoch 0 arrives
    const staleResult = commitBoxOpenAnimation(epoch1State, 5, 0, null);

    // Must be completely ignored: state remains unchanged
    assert.strictEqual(staleResult.epoch, 1);
    assert.strictEqual(staleResult.phase, 'CHOOSE_PLAYER_BOX');
    assert.strictEqual(staleResult.openingBoxId, null);
    assert.strictEqual(staleResult.eliminatedAmounts.size, 0, 'No amounts should be eliminated');
    const box5 = staleResult.boxes.find((b) => b.id === 5);
    assert.strictEqual(box5?.isOpened, false, 'Box 5 must remain closed');
  });

  it('5. 恢复snapshot立即显示 (Reconnection/initial snapshot restores opened boxes immediately without animation)', () => {
    const initialState = createInitialPresentationState(0);

    // Server snapshot with 3 already-opened boxes
    const serverSnapshot = createMockSnapshot({
      phase: 'OPENING',
      currentRound: 2,
      boxesToOpenThisRound: 4,
      boxes: initialState.boxes.map((b) => {
        if (b.id === 1) return { id: 1, status: 'selected' as const };
        if (b.id === 2) return { id: 2, status: 'opened' as const, revealedAmount: 100 };
        if (b.id === 3) return { id: 3, status: 'opened' as const, revealedAmount: 500 };
        if (b.id === 4) return { id: 4, status: 'opened' as const, revealedAmount: 10000 };
        return { id: b.id, status: 'unopened' as const };
      }),
    });

    // Reconnection / restore: isInitialOrReconnect = true
    const result = applySnapshotToPresentation(initialState, serverSnapshot, true);

    // Should NOT trigger any animation
    assert.strictEqual(result.shouldAnimateBoxId, null, 'Should not trigger animation on restore');
    assert.strictEqual(result.state.openingBoxId, null, 'openingBoxId should be null');

    // Boxes 2, 3, 4 should immediately be opened in presentation state
    const box2 = result.state.boxes.find((b) => b.id === 2);
    const box3 = result.state.boxes.find((b) => b.id === 3);
    const box4 = result.state.boxes.find((b) => b.id === 4);
    assert.ok(box2 && box2.isOpened && box2.value === 100);
    assert.ok(box3 && box3.isOpened && box3.value === 500);
    assert.ok(box4 && box4.isOpened && box4.value === 10000);

    // Ladder eliminated amounts should immediately include 100, 500, 10000
    assert.strictEqual(result.state.eliminatedAmounts.has(100), true);
    assert.strictEqual(result.state.eliminatedAmounts.has(500), true);
    assert.strictEqual(result.state.eliminatedAmounts.has(10000), true);
    assert.strictEqual(result.state.eliminatedAmounts.size, 3);
  });

  it('6. 多箱并发打开队列播放 (Multiple unpresented opened boxes animate sequentially)', () => {
    const initialState = createInitialPresentationState(0);
    initialState.phase = 'OPEN_BOXES';
    initialState.playerBoxId = 1;
    initialState.boxesLeftToOpenThisRound = 2;

    // Server snapshot where two boxes (3 and 7) are opened simultaneously by server
    const serverSnapshot = createMockSnapshot({
      phase: 'OFFERING',
      boxesToOpenThisRound: 0,
      currentOffer: {
        offerId: 'off_multi',
        amount: 88888,
        expiresAt: 1700000030000,
      },
      boxes: initialState.boxes.map((b) => {
        if (b.id === 1) return { id: 1, status: 'selected' as const };
        if (b.id === 3) return { id: 3, status: 'opened' as const, revealedAmount: 25000 };
        if (b.id === 7) return { id: 7, status: 'opened' as const, revealedAmount: 75000 };
        return { id: b.id, status: 'unopened' as const };
      }),
    });

    // Step 1: Snapshot arrives. First unpresented box (box 3) should begin animating
    const step1 = applySnapshotToPresentation(initialState, serverSnapshot, false);
    assert.strictEqual(step1.shouldAnimateBoxId, 3, 'Box 3 should be first to animate');
    assert.strictEqual(step1.state.openingBoxId, 3);
    assert.strictEqual(step1.state.pendingRevealAmount, 25000);
    // Suspense: offer & phase held back
    assert.strictEqual(step1.state.bankerOffer, 0);
    assert.strictEqual(step1.state.phase, 'OPEN_BOXES');

    // Step 2: Box 3 completes its animation
    const step2 = commitBoxOpenAnimation(step1.state, 3, 0, serverSnapshot);
    // Box 3 is committed
    const box3 = step2.boxes.find((b) => b.id === 3);
    assert.ok(box3 && box3.isOpened && box3.value === 25000);
    assert.strictEqual(step2.eliminatedAmounts.has(25000), true);

    // Box 7 must now automatically queue as next openingBoxId!
    assert.strictEqual(step2.openingBoxId, 7, 'Box 7 should now be openingBoxId');
    assert.strictEqual(step2.pendingRevealAmount, 75000);
    // Suspense: offer & phase MUST STILL be held back because box 7 is opening!
    assert.strictEqual(step2.bankerOffer, 0, 'Offer must remain 0 while box 7 is opening');
    assert.strictEqual(step2.phase, 'OPEN_BOXES', 'Phase must remain OPEN_BOXES while box 7 is opening');

    // Step 3: Box 7 completes its animation
    const step3 = commitBoxOpenAnimation(step2, 7, 0, serverSnapshot);
    // Box 7 is committed
    const box7 = step3.boxes.find((b) => b.id === 7);
    assert.ok(box7 && box7.isOpened && box7.value === 75000);
    assert.strictEqual(step3.eliminatedAmounts.has(75000), true);

    // No more unpresented boxes! Now presentation phase and offer catch up!
    assert.strictEqual(step3.openingBoxId, null, 'openingBoxId should now be null');
    assert.strictEqual(step3.bankerOffer, 88888, 'Offer should now be 88,888');
    assert.strictEqual(step3.phase, 'BANKER_OFFER', 'Phase should now advance to BANKER_OFFER');
    assert.strictEqual(step3.boxesLeftToOpenThisRound, 0);
  });

  it('7. 跨游戏回调被丢弃 (Stale callback from different gameId is ignored)', () => {
    const state = createInitialPresentationState(0);
    state.gameId = 'game_current_456';
    state.openingBoxId = 5;
    state.pendingRevealAmount = 10000;

    // Callback arrives with a different gameId
    const result = commitBoxOpenAnimation(state, 5, 0, null, 'game_old_123');

    // Must be rejected
    assert.strictEqual(result.openingBoxId, 5, 'openingBoxId must remain 5');
    assert.strictEqual(result.eliminatedAmounts.size, 0, 'No amount should be eliminated');
    const box5 = result.boxes.find((b) => b.id === 5);
    assert.strictEqual(box5?.isOpened, false, 'Box 5 must remain unopened');
  });

  it('8. 金额缺失严格防御不替零 (Missing revealed amount is never replaced with 0)', () => {
    const state = createInitialPresentationState(0);
    state.openingBoxId = 5;
    state.pendingRevealAmount = null; // Missing pending amount

    // Authoritative snapshot also has missing or unopened box
    const snapshotWithoutBox = createMockSnapshot({
      boxes: state.boxes.map((b) => ({ id: b.id, status: 'unopened' as const })),
    });

    const result = commitBoxOpenAnimation(state, 5, 0, snapshotWithoutBox);

    // Must not commit with 0!
    assert.strictEqual(result.openingBoxId, 5);
    assert.strictEqual(result.eliminatedAmounts.has(0), false);
    const box5 = result.boxes.find((b) => b.id === 5);
    assert.strictEqual(box5?.isOpened, false);
  });

  it('9. 最终两箱 keep/swap 阶段映射 (Final swap phase maps correctly to FINAL_SWAP)', () => {
    const state = createInitialPresentationState(0);
    const snapshot = createMockSnapshot({
      phase: 'FINAL_SWAP',
      currentRound: 9,
      boxesToOpenThisRound: 0,
      totalOpenedBoxes: 24,
      unopenedCount: 2,
    });

    const result = applySnapshotToPresentation(state, snapshot, false);
    assert.strictEqual(result.state.phase, 'FINAL_SWAP');
  });
});
