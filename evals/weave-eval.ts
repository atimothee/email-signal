/**
 * Shared Weave-Evaluation boilerplate for the eval suite.
 *
 * Each eval supplies its dataset rows, a `model` fn, and a map of named scorer
 * fns; this module owns the repeated plumbing: the `WANDB_API_KEY` skip guard,
 * the lazy `weave` import, project resolution, op-wrapping of the model + scorers,
 * the versioned `weave.Dataset`, and the `weave.Evaluation` run (best-effort,
 * never throws). It is the single place that knows the weave SDK's Evaluation
 * shape, so the individual `*.eval.ts` files stay small and don't copy-paste it.
 *
 * Skip semantics: returns `false` (a no-op) when `WANDB_API_KEY` is unset, so each
 * eval keeps its own local pass/fail path regardless of Weave.
 *
 * Versioning: `datasetId` is a STABLE name (e.g. `email-safety-cases`). Re-running
 * after editing rows publishes a NEW VERSION of that dataset in W&B rather than
 * silently overwriting it — so eval runs stay comparable over time.
 */

export interface WeaveEvalSpec<Row extends Record<string, unknown>, Out> {
  /** Stable, human-readable dataset name. New row contents → new W&B version. */
  datasetId: string;
  /** Stable Evaluation id (the run grouping in W&B). */
  evaluationId: string;
  /** Op name for the model under test (the dashboard column). */
  modelName: string;
  /** Dataset rows. Each SHOULD carry a unique `id`/`name` the scorers can look up. */
  rows: Row[];
  /** The model under test: maps one row to its output. May be async. */
  model: (row: Row) => Out | Promise<Out>;
  /** Named scorers: each compares a row to the model's output for that row. */
  scorers: Record<string, (row: Row, output: Out) => unknown>;
}

/**
 * Run `spec` as a W&B Weave Evaluation. No-op + returns false when
 * `WANDB_API_KEY` is unset or the weave SDK errors (Weave is always optional).
 * Returns true only when the Evaluation actually ran.
 */
export async function logWeaveEvaluation<Row extends Record<string, unknown>, Out>(
  spec: WeaveEvalSpec<Row, Out>
): Promise<boolean> {
  if (!process.env['WANDB_API_KEY']) return false;
  try {
    // `weave` is a heavy, Node-only dep — import lazily so eval files that skip
    // Weave (no key) never pay for it, and so type-skew stays contained here.
    const weave: any = await import('weave');
    // Eval runs land in a SEPARATE project from prod traces by default
    // (overridable via WANDB_PROJECT) so prod traces stay uncluttered (#47).
    const evalProject = process.env['WANDB_PROJECT'] ?? 'email-signal-evals';
    await weave.init(evalProject);

    const dataset = new weave.Dataset({ id: spec.datasetId, rows: spec.rows });

    // weave's Evaluation passes the row as `input.datasetRow` to the model op and
    // `{ datasetRow, modelOutput }` to each scorer (see categorization.eval.ts).
    const model = weave.op(
      async (input: any) => spec.model((input?.datasetRow ?? input) as Row),
      { name: spec.modelName }
    );

    const scorers = Object.entries(spec.scorers).map(([name, fn]) =>
      weave.op(({ datasetRow, modelOutput }: any) => fn(datasetRow as Row, modelOutput as Out), {
        name,
      })
    );

    const evaluation = new weave.Evaluation({ id: spec.evaluationId, dataset, scorers });
    await evaluation.evaluate({ model });
    console.log('  ↳ logged Weave evaluation to W&B project', evalProject);
    return true;
  } catch (err) {
    console.warn('  ↳ weave logging skipped:', (err as Error)?.message ?? err);
    return false;
  }
}
