import { Component } from "react";
import { posText as t } from "./i18n.js";

export default class PosErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  // The detail goes to the console for developers; the merchant sees only the plain message.
  componentDidCatch(error, info) {
    console.error("A POS screen failed to render.", error, info?.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <main className="mx-auto w-full max-w-3xl px-4 py-6" role="alert">
          <section className="rounded-2xl border-2 border-rose-900 bg-rose-100 p-4 text-rose-950">
            <h1 className="text-xl font-extrabold">{t("money.screenError")}</h1>
            <button type="button" onClick={() => this.setState({ error: null })} className="mt-4 min-h-12 rounded-xl border-2 border-rose-900 bg-white px-4 text-base font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-900">
              {t("money.retry")}
            </button>
          </section>
        </main>
      );
    }

    return this.props.children;
  }
}
