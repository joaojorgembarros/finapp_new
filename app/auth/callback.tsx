import React, { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { Redirect } from "expo-router";
import {
  completeGoogleOAuthCallback,
  googleOAuthDedupe,
  isGoogleAuthCancelled,
} from "../../src/lib/googleAuth";
import { getPostAuthHref } from "../../src/lib/postAuthHref";
import { supabase } from "../../src/lib/supabase";
import { useSession } from "../../src/providers/SessionProvider";

export default function GoogleAuthCallbackScreen() {
  const { session, loading } = useSession();
  const [callbackReady, setCallbackReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    WebBrowser.maybeCompleteAuthSession();

    const completeFromUrl = async (url: string | null) => {
      if (!url || cancelled) return;
      try {
        await completeGoogleOAuthCallback(url, supabase.auth, googleOAuthDedupe);
      } catch (error) {
        if (!isGoogleAuthCancelled(error) && typeof __DEV__ !== "undefined" && __DEV__) {
          console.warn("Could not complete Google sign-in callback.");
        }
      }
    };

    void (async () => {
      await completeFromUrl(await Linking.getInitialURL());
      if (!cancelled) setCallbackReady(true);
    })();

    const subscription = Linking.addEventListener("url", (event) => {
      void completeFromUrl(event.url);
    });

    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  if (session) return <Redirect href={getPostAuthHref(session)} />;
  if (loading || !callbackReady) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#06152E" }}>
        <ActivityIndicator color="#FDECD6" />
      </View>
    );
  }

  return <Redirect href="/(auth)/login" />;
}

