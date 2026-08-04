import { useCallback, useEffect, useRef, useState } from "react";
import { Keyboard, LayoutChangeEvent, Platform, ScrollView } from "react-native";

export function useKeyboardAwareScroll<Field extends string>(topOffset = 16) {
  const scrollRef = useRef<ScrollView>(null);
  const fieldY = useRef<Partial<Record<Field, number>>>({});
  const focusedField = useRef<Field | null>(null);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  const scrollToField = useCallback((field: Field, delay = 80) => {
    const y = fieldY.current[field];
    if (typeof y !== "number") return;
    setTimeout(() => {
      scrollRef.current?.scrollTo({ y: Math.max(y - topOffset, 0), animated: true });
    }, delay);
  }, [topOffset]);

  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const showSub = Keyboard.addListener(showEvent, (event) => {
      setKeyboardVisible(true);
      setKeyboardHeight(Platform.OS === "android" ? event.endCoordinates.height : 0);
      if (focusedField.current) scrollToField(focusedField.current, 100);
    });
    const hideSub = Keyboard.addListener(hideEvent, () => {
      setKeyboardVisible(false);
      setKeyboardHeight(0);
      focusedField.current = null;
    });

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [scrollToField]);

  const registerField = useCallback((field: Field) => (event: LayoutChangeEvent) => {
    fieldY.current[field] = event.nativeEvent.layout.y;
  }, []);

  const focusField = useCallback((field: Field) => {
    focusedField.current = field;
    scrollToField(field, keyboardVisible ? 40 : 240);
  }, [keyboardVisible, scrollToField]);

  return {
    scrollRef,
    keyboardHeight,
    keyboardVisible,
    registerField,
    focusField,
  };
}
