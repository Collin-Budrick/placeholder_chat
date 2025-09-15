declare module "~icons/*" {
  import type { Component } from "@builder.io/qwik";
  const Icon: Component<{ class?: string; [key: string]: unknown }>;
  export default Icon;
}
