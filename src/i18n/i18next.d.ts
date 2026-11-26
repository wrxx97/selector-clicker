import "i18next";
import type english from "./locales/en/translation.json";

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation";
    resources: { translation: typeof english };
    strictKeyChecks: true;
  }
}
