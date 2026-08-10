import assert from "node:assert/strict";
import {
  deploymentInventory,
  semanticTopology,
  validateBranches,
  validateDeploymentModel,
} from "./core.mjs";
import { Diagram } from "./builder.mjs";
import { dependencyMatrix, frame, icon, renderTree } from "./layout-engine.mjs";
import { typePreset } from "./types.mjs";

export function runSelfTest() {
  assert.equal(new Diagram().type, "deployment");
  assert.equal(typePreset("unknown"), typePreset("deployment"));
  const diagram = new Diagram("deployment", { contract: "bake" });
  diagram.box("source_group", [40, 80], [260, 180], "Sources", { ob: false, semanticGroup: true });
  diagram.box("target_group", [420, 80], [260, 180], "Targets", { ob: false, semanticGroup: true });
  diagram.icon("source_a", "lambda", [80, 130], { parent: "source_group", deploymentId: "lambda.source_a" });
  diagram.icon("source_b", "lambda", [180, 130], { parent: "source_group", deploymentId: "lambda.source_b" });
  diagram.icon("target_a", "dynamodb", [460, 130], { parent: "target_group", deploymentId: "table.target_a" });
  diagram.icon("target_b", "dynamodb", [560, 130], { parent: "target_group", deploymentId: "table.target_b" });
  diagram.icon("source_single", "api_gateway", [40, 340], { deploymentId: "api.source" });
  diagram.icon("target_single", "s3", [640, 500], { deploymentId: "bucket.target" });
  diagram.link("source_group", "target_group", "all-to-all");
  diagram.link("source_single", "target_group", "one-to-all");
  diagram.link("source_group", "target_single", "all-to-one");
  const xml = diagram.mxfile();
  assert.equal(semanticTopology(xml).relationships.length, 8);
  assert.equal(deploymentInventory(xml).resources.length, 6);
  assert.equal(deploymentInventory(xml).relationships.length, 8);
  assert.equal(validateDeploymentModel(xml).errors.length, 0);

  const duplicate = new Diagram("deployment");
  duplicate.icon("one", "lambda", [20, 20], { deploymentId: "same" });
  duplicate.icon("two", "lambda", [180, 20], { deploymentId: "same" });
  assert.equal(validateDeploymentModel(duplicate.mxfile()).errors.length, 1);

  const split = new Diagram("deployment", { contract: "bake" });
  split.icon("source", "s3", [20, 80]);
  split.junction("split", [180, 100]);
  split.icon("lambda", "lambda", [340, 20]);
  split.icon("queue", "sqs", [340, 160]);
  split.link("source", "split");
  split.link("split", "lambda");
  split.link("split", "queue");
  assert.equal(validateBranches(split.mxfile()).length, 0);

  const matrixDiagram = new Diagram("deployment");
  renderTree(matrixDiagram, frame("root_frame", "Deployment", {}, [
    dependencyMatrix("matrix", "Dependencies", {
      rows: ["upload", "query"],
      columns: ["s3", "dynamodb"],
      relations: [["upload", "s3"], ["query", "dynamodb"]],
    }),
    icon("deployed", "lambda", "Worker"),
  ]));
  assert.match(matrixDiagram.mxfile(), /documentationOnly=1/);

  return { ok: true, assertions: 9 };
}
