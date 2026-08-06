import { useCallback, useEffect, useRef, useState } from "react";
import {
  Dimensions,
  Keyboard,
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  ScrollView,
  View,
} from "react-native";
import {
  getKeyboardBottomSpace,
  getKeyboardScrollAdjustment,
} from "../lib/keyboardScroll";

type KeyboardAwareScrollOptions = {
  ensureFieldRunway?: boolean;
  keyboardClearance?: number;
};

export function useKeyboardAwareScroll<Field extends string>(
  topOffset = 16,
  {
    ensureFieldRunway = false,
    keyboardClearance = 18,
  }: KeyboardAwareScrollOptions = {}
) {
  const safeKeyboardClearance = Number.isFinite(keyboardClearance)
    ? Math.max(0, keyboardClearance)
    : 18;
  const scrollRef = useRef<ScrollView>(null);
  const fieldLayout = useRef<Partial<Record<Field, { y: number; height: number }>>>({});
  const fieldNode = useRef<Partial<Record<Field, View | null>>>({});
  const focusedField = useRef<Field | null>(null);
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const manualScroll = useRef(false);
  const keyboardShowing = useRef(false);
  const keyboardOverlap = useRef(0);
  const keyboardTop = useRef(Number.POSITIVE_INFINITY);
  const currentScrollY = useRef(0);
  const contentHeight = useRef(0);
  const measurementId = useRef(0);
  const visibilityMeasurementId = useRef(0);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [keyboardInset, setKeyboardInset] = useState(0);

  const clearPendingScroll = useCallback(() => {
    if (scrollTimer.current === null) return;
    clearTimeout(scrollTimer.current);
    scrollTimer.current = null;
  }, []);

  const cancelPendingScroll = useCallback(() => {
    manualScroll.current = true;
    visibilityMeasurementId.current += 1;
    clearPendingScroll();
  }, [clearPendingScroll]);

  const scrollToField = useCallback((field: Field, delay = 80) => {
    clearPendingScroll();
    if (manualScroll.current) return;
    const layout = fieldLayout.current[field];
    if (!layout) return;
    const requestId = ++visibilityMeasurementId.current;
    scrollTimer.current = setTimeout(() => {
      scrollTimer.current = null;
      if (manualScroll.current || requestId !== visibilityMeasurementId.current) return;

      const fallbackScroll = () => {
        if (manualScroll.current || requestId !== visibilityMeasurementId.current) return;
        scrollRef.current?.scrollTo({
          y: Math.max(layout.y - topOffset, 0),
          animated: true,
        });
      };
      const node = fieldNode.current[field];
      const nativeScrollView = scrollRef.current?.getNativeScrollRef();

      if (!node || !nativeScrollView || !keyboardShowing.current) {
        fallbackScroll();
        return;
      }

      nativeScrollView.measureInWindow((_scrollX, scrollY, _scrollWidth, scrollHeight) => {
        if (
          manualScroll.current ||
          requestId !== visibilityMeasurementId.current ||
          !keyboardShowing.current
        ) return;

        node.measureInWindow((_fieldX, fieldY, _fieldWidth, fieldHeight) => {
          if (
            manualScroll.current ||
            requestId !== visibilityMeasurementId.current ||
            !keyboardShowing.current
          ) return;

          const adjustment = getKeyboardScrollAdjustment({
            scrollWindowY: scrollY,
            scrollWindowHeight: scrollHeight,
            keyboardTop: keyboardTop.current,
            fieldWindowY: fieldY,
            fieldHeight,
            currentScrollY: currentScrollY.current,
            contentHeight: contentHeight.current,
            topOffset,
            bottomOffset: safeKeyboardClearance,
          });

          if (!adjustment) {
            const visibleTop = scrollY + topOffset;
            const visibleBottom = Math.min(
              scrollY + scrollHeight,
              keyboardTop.current
            ) - safeKeyboardClearance;
            const geometryIsInvalid = !Number.isFinite(visibleBottom) || visibleBottom <= visibleTop;
            if (!geometryIsInvalid) return;
            fallbackScroll();
            return;
          }

          if (
            ensureFieldRunway &&
            contentHeight.current > 0 &&
            adjustment.missingRunway > 0
          ) {
            const missingRunway = Math.min(
              adjustment.missingRunway,
              360
            );
            setKeyboardInset((current) =>
              Math.min(
                current + missingRunway,
                Math.max(keyboardOverlap.current, 640)
              )
            );
            return;
          }

          scrollRef.current?.scrollTo({ y: adjustment.targetY, animated: true });
        });
      });
    }, delay);
  }, [clearPendingScroll, ensureFieldRunway, safeKeyboardClearance, topOffset]);

  const updateBottomSpace = useCallback((field: Field | null, overlap: number) => {
    const height = field ? fieldLayout.current[field]?.height : undefined;
    setKeyboardInset(
      ensureFieldRunway
        ? getKeyboardBottomSpace(
            overlap,
            height,
            Math.max(topOffset, safeKeyboardClearance)
          )
        : Math.max(0, overlap)
    );
  }, [ensureFieldRunway, safeKeyboardClearance, topOffset]);

  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const showSub = Keyboard.addListener(showEvent, (event) => {
      keyboardShowing.current = true;
      setKeyboardVisible(true);

      const keyboardHeight = Math.max(0, event.endCoordinates.height);
      const reportedKeyboardTop = event.endCoordinates.screenY;
      keyboardTop.current = reportedKeyboardTop > 0
        ? reportedKeyboardTop
        : Math.max(0, Dimensions.get("screen").height - keyboardHeight);

      const finishAdjustment = (inset: number) => {
        if (!keyboardShowing.current) return;
        keyboardOverlap.current = inset;
        updateBottomSpace(focusedField.current, inset);
        if (!manualScroll.current && focusedField.current) {
          scrollToField(focusedField.current, Platform.OS === "ios" ? 100 : 80);
        }
      };

      if (Platform.OS === "ios") {
        finishAdjustment(0);
        return;
      }

      const currentMeasurement = ++measurementId.current;
      const scrollView = scrollRef.current?.getNativeScrollRef();

      if (!scrollView) {
        finishAdjustment(keyboardHeight);
        return;
      }

      scrollView.measureInWindow((_x, y, _width, height) => {
        if (currentMeasurement !== measurementId.current || !keyboardShowing.current) return;
        const overlap = Math.max(
          0,
          Math.min(keyboardHeight, y + height - keyboardTop.current)
        );
        finishAdjustment(overlap);
      });
    });
    const hideSub = Keyboard.addListener(hideEvent, () => {
      keyboardShowing.current = false;
      keyboardOverlap.current = 0;
      keyboardTop.current = Number.POSITIVE_INFINITY;
      measurementId.current += 1;
      visibilityMeasurementId.current += 1;
      manualScroll.current = false;
      clearPendingScroll();
      setKeyboardVisible(false);
      setKeyboardInset(0);
      focusedField.current = null;
    });

    return () => {
      keyboardShowing.current = false;
      measurementId.current += 1;
      visibilityMeasurementId.current += 1;
      clearPendingScroll();
      showSub.remove();
      hideSub.remove();
    };
  }, [clearPendingScroll, scrollToField, updateBottomSpace]);

  const registerField = useCallback((field: Field) => (event: LayoutChangeEvent) => {
    const { y, height } = event.nativeEvent.layout;
    fieldLayout.current[field] = { y, height };
  }, []);

  const registerFieldNode = useCallback((field: Field) => (node: View | null) => {
    fieldNode.current[field] = node;
  }, []);

  const focusField = useCallback((field: Field) => {
    manualScroll.current = false;
    focusedField.current = field;
    if (keyboardShowing.current) {
      updateBottomSpace(field, keyboardOverlap.current);
    }
    scrollToField(field, keyboardVisible ? 60 : 240);
  }, [keyboardVisible, scrollToField, updateBottomSpace]);

  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    currentScrollY.current = event.nativeEvent.contentOffset.y;
  }, []);

  const handleContentSizeChange = useCallback((_width: number, height: number) => {
    contentHeight.current = height;
    if (!keyboardShowing.current || manualScroll.current || !focusedField.current) return;
    scrollToField(focusedField.current, 30);
  }, [scrollToField]);

  return {
    scrollRef,
    keyboardVisible,
    keyboardInset,
    registerField,
    registerFieldNode,
    focusField,
    cancelPendingScroll,
    handleScroll,
    handleContentSizeChange,
  };
}
