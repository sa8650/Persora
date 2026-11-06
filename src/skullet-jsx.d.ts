import "react";

declare module "react" {
  interface HTMLAttributes<T> {
    "skullet-block"?: string;
    "skullet-ignore"?: string;
  }
}
