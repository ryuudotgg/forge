__PAGE_HEAD__

type InvitationState =
  | { readonly status: "checking" }
  | { readonly status: "signed-out" }
  | { readonly status: "ready" }
  | { readonly status: "accepting" }
  | { readonly status: "accepted" }
  | { readonly status: "failed"; readonly message: string };

const sessionCheckFailed: InvitationState = {
  status: "failed",
  message: "We couldn't check your session.",
};

interface AcceptInvitationProps {
  readonly invitationId: string;
}

function AcceptInvitation({ invitationId }: AcceptInvitationProps) {
  const [state, setState] = useState<InvitationState>({ status: "checking" });

  useEffect(() => {
    authClient.getSession().then(
      ({ data, error }) => {
        setState(
          error
            ? sessionCheckFailed
            : { status: data ? "ready" : "signed-out" },
        );
      },
      () => setState(sessionCheckFailed),
    );
  }, []);

  async function accept() {
    setState({ status: "accepting" });

    const { error } = await authClient.organization.acceptInvitation({
      invitationId,
    });

    setState(
      error
        ? {
            status: "failed",
            message: error.message ?? "We couldn't accept this invitation.",
          }
        : { status: "accepted" },
    );
  }

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center gap-4 px-6 py-20">
      <h1 className="text-2xl font-semibold tracking-tight">Invitation</h1>
      {state.status === "checking" && <p>Checking your session.</p>}
      {state.status === "signed-out" && (
        <p>
          Sign in with the invited email address, then open this link again.
        </p>
      )}
      {(state.status === "ready" || state.status === "accepting") && (
        <button
          type="button"
          disabled={state.status === "accepting"}
          onClick={accept}
        >
          Accept invitation
        </button>
      )}
      {state.status === "accepted" && <p>You joined the organization.</p>}
      {state.status === "failed" && <p>{state.message}</p>}
    </main>
  );
}
