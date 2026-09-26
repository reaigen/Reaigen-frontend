import type { Metadata } from "next";
import { HomeAuthScreen } from "./components/home-auth-screen";
import { AUTH_IMAGE_MEDIA, AUTH_IMAGE_SIZES, AUTH_IMAGE_SRC, AUTH_IMAGE_SRCSET } from "./lib/auth-brand-image";

export const metadata: Metadata = {
  title: "Sign in",
};

export default function Home() {
  return (
    <>
      {/* Starts the brand photo while the session check runs, desktop only (React hoists it into <head>). */}
      <link
        rel="preload"
        as="image"
        href={AUTH_IMAGE_SRC}
        imageSrcSet={AUTH_IMAGE_SRCSET}
        imageSizes={AUTH_IMAGE_SIZES}
        media={AUTH_IMAGE_MEDIA}
        type="image/webp"
        fetchPriority="high"
      />
      <HomeAuthScreen />
    </>
  );
}
