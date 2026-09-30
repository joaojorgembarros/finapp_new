import React, { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { Href, Redirect } from "expo-router";
import { getGoogleCallbackRedirect } from "../../src/lib/googleAuth";
import { getPostAuthHref } from "../../src/lib/postAuthHref";
import { useSession } from "../../src/providers/SessionProvider";

export default function GoogleAuthCallbackScreen() {
  const { session, loading, consumeGoogleOAuthUrl } = useSession();
  const [callbackReady, setCallbackReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    WebBrowser.maybeCompleteAuthSession();

    const completeFromUrl = async (url: string | null) => {
      if (!url || cancelled) return;
      await consumeGoogleOAuthUrl(url);
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
  }, [consumeGoogleOAuthUrl]);

  const destination = getGoogleCallbackRedirect({
    session,
    loading,
    callbackReady,
    authenticatedHref: session ? (getPostAuthHref(session) as string) : "/(app)/journey",
  });

  if (destination.pending) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#06152E" }}>
        <ActivityIndicator color="#FDECD6" />
      </View>
    );
  }

  return <Redirect href={destination.href as Href} />;
}
