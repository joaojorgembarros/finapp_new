// app/+not-found.tsx
import React from "react";
import { router } from "expo-router";
import Screen from "../src/ui/Screen";
import { Button, Card, H1, P } from "../src/ui/components";

export default function NotFound() {
  return (
    <Screen scroll={false} style={{ justifyContent: "center" }}>
      <Card>
        <H1>Ops</H1>
        <P muted>Essa tela não existe.</P>
        <Button title="Voltar para o início" onPress={() => router.replace("/")} />
      </Card>
    </Screen>
  );
}
