import type { Metadata } from "next";
import { HomeAuthScreen } from "./components/home-auth-screen";

export const metadata: Metadata = {
  title: "Sign in",
};

export default function Home() {
  return <HomeAuthScreen />;
}
