# Workflow Apps

Use this reference when the user wants to create or publish an OSMO app from a
workflow. This can be a direct request before submission, or a follow-up after a
workflow completes.

## Create an App

1. Determine the workflow YAML path.
   - If the user already has a workflow YAML file, use that path.
   - If the app is based on a completed workflow, use the submitted spec file
     from the current workflow cycle.
   - If there is no local YAML/spec yet, create or fetch one using the relevant
     workflow generation/status reference before creating the app.
2. Decide on a name and description.
   - If the user explicitly asked to create an app, ask for the name and suggest
     a default derived from the workflow name.
   - If offering post-completion, present a suggested name and one-sentence
     description in a single prompt.
3. After confirmation, run:
   ```bash
   osmo app create <app_name> --description "<description>" --file <workflow_yaml>
   ```
4. Report the app identifier or URL returned by the CLI.
