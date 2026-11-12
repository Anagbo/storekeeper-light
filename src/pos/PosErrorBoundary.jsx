import { Component } from "react";
import { posText as t } from "./i18n.js";

// A screen that throws while rendering shows this instead of a blank page. "Try again" renders the
// screen once more; if it fails again it is not offered a second time (it would only reload into the
// same crash). "Go back" returns to the previous screen the way its own Back does, so the draft is kept.
export default class PosErrorBoundary extends Component {
  state = { error: null, retried: false };

  static getDerivedStateFromError(error) {
    return { error };
  }

  // The detail goes to the console for developers; the merchant sees only the plain message.
  componentDidCatch(error, info) {
    console.error("A POS screen failed to render.", error, info?.componentStack);
  }

  render() {
    if (this.state.error) {
      const buttonClass = "min-h-12 rounded-xl border-2 border-rose-900 bg-white px-4 text-base font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-900";
      return (
        <main className="mx-auto w-full max-w-3xl px-4 py-6" role="alert">
          <section className="rounded-2xl border-2 border-rose-900 bg-rose-100 p-4 text-rose-950">
            <h1 className="text-xl font-extrabold">{t("money.screenError")}</h1>
            <div className="mt-4 flex flex-wrap gap-2">
              {this.props.onBack && (
                <button type="button" onClick={() => this.props.onBack()} className={buttonClass}>
                  {t("money.goBack")}
                </button>
              )}
              {!this.state.retried && (
                <button type="button" onClick={() => this.setState({ error: null, retried: true })} className={buttonClass}>
                  {t("money.retry")}
                </button>
              )}
            </div>
          </section>
        </main>
      );
    }

    return this.props.children;
  }
}
