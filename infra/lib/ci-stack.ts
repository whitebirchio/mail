import { Duration, Stack, type StackProps, Tags } from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import type { Construct } from "constructs";
import { CDK_QUALIFIER } from "./config.js";

export interface CiStackProps extends StackProps {
  /** e.g. "repo:whitebirchio@<org-id>/mail@<repo-id>" */
  subjectPrefix: string;
}

/**
 * GitHub Actions → AWS without long-lived keys. Deployed once by the owner.
 * The role can do nothing itself except assume CDK's bootstrap roles, which
 * perform the deploy (CDK's least-privilege pattern). Only main deploys
 * (ADR-002), so unlike Trader's role it trusts only main's subject: a workflow
 * edited on a branch can't reach production. The account already has
 * GitHub's OIDC provider (TraderCi created it), so this imports it: an
 * account can hold only one provider per URL.
 */
export class CiStack extends Stack {
  readonly deployRole: iam.Role;

  constructor(scope: Construct, id: string, props: CiStackProps) {
    super(scope, id, props);
    Tags.of(this).add("app", "mail");

    const provider = iam.OpenIdConnectProvider.fromOpenIdConnectProviderArn(
      this,
      "GitHubOidc",
      `arn:aws:iam::${this.account}:oidc-provider/token.actions.githubusercontent.com`,
    );

    this.deployRole = new iam.Role(this, "DeployRole", {
      roleName: "mail-github-deploy",
      description: "Assumed by GitHub Actions in whitebirchio/mail to run cdk deploy",
      maxSessionDuration: Duration.hours(1),
      assumedBy: new iam.WebIdentityPrincipal(provider.openIdConnectProviderArn, {
        StringEquals: {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
          "token.actions.githubusercontent.com:sub": `${props.subjectPrefix}:ref:refs/heads/main`,
        },
      }),
    });

    this.deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "AssumeCdkBootstrapRoles",
        actions: ["sts:AssumeRole"],
        resources: [`arn:aws:iam::${this.account}:role/cdk-${CDK_QUALIFIER}-*-${this.account}-${this.region}`],
      }),
    );
  }
}
