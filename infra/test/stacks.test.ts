import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { AppStack } from "../lib/app-stack.js";
import { CertsStack } from "../lib/certs-stack.js";
import { CiStack } from "../lib/ci-stack.js";

const env = { account: "123456789012", region: "us-east-1" };

function synth() {
  const app = new App();
  const certs = new CertsStack(app, "MailCerts", { env });
  const codeDir = mkdtempSync(join(tmpdir(), "mail-code-"));
  writeFileSync(join(codeDir, "index.js"), "// test stand-in for apps/web/dist/app\n");
  const prod = new AppStack(app, "MailProduction", { env, certificate: certs.certificate, codeDir });
  const ci = new CiStack(app, "MailCi", { env, subjectPrefix: "repo:whitebirchio@1/mail@2" });
  return { prod: Template.fromStack(prod), ci: Template.fromStack(ci), certs: Template.fromStack(certs) };
}
const { prod, ci, certs } = synth();

type Statement = { Sid?: string; Action: string | string[]; Resource: unknown };
const roleStatements = (t: Template): Statement[] =>
  Object.values(t.findResources("AWS::IAM::Policy")).flatMap((p) => (p as { Properties: { PolicyDocument: { Statement: Statement[] } } }).Properties.PolicyDocument.Statement);

describe("MailCerts", () => {
  it("issues one DNS-validated certificate for mail.whitebirch.io", () => {
    certs.resourceCountIs("AWS::CertificateManager::Certificate", 1);
    certs.hasResourceProperties("AWS::CertificateManager::Certificate", { DomainName: "mail.whitebirch.io", ValidationMethod: "DNS" });
  });
});

describe("MailProduction", () => {
  it("lets the function read exactly the two mail secrets and nothing else in SSM", () => {
    const ssm = roleStatements(prod).filter((s) => JSON.stringify(s.Action).includes("ssm:"));
    expect(ssm).toHaveLength(1);
    expect(ssm[0]!.Action).toBe("ssm:GetParameters");
    const resources = JSON.stringify(ssm[0]!.Resource);
    expect(resources).toContain("parameter/mail/production/GOOGLE_CLIENT_SECRET");
    expect(resources).toContain("parameter/mail/production/SESSION_KEY");
    expect(resources).not.toContain("*");
    expect(resources).not.toContain("/trader/");
  });

  it("grants no access to SES, SNS, S3 writes, DynamoDB or other data stores", () => {
    const actions = roleStatements(prod)
      .filter((s) => s.Sid === "WriteOwnLogs" || s.Sid === "ReadMailSecrets")
      .flatMap((s) => (Array.isArray(s.Action) ? s.Action : [s.Action]));
    expect(actions.sort()).toEqual(["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents", "ssm:GetParameters"]);
  });

  it("runs on Node 24 with config from the environment, and never a secret there", () => {
    prod.hasResourceProperties("AWS::Lambda::WebFunctionRevision", {
      BuildConfig: { RuntimeConfig: { Runtime: "nodejs24.x" } },
      ServiceConfig: {
        EnvironmentVariables: {
          NODE_ENV: "production",
          APP_URL: "https://mail.whitebirch.io",
          OWNER_EMAIL: "scott.schmalz@gmail.com",
          GOOGLE_CLIENT_ID: Match.stringLikeRegexp("\\.apps\\.googleusercontent\\.com$"),
          SECRETS_PATH: "/mail/production/",
        },
      },
    });
    const revision = JSON.stringify(prod.findResources("AWS::Lambda::WebFunctionRevision"));
    expect(revision).not.toMatch(/GOOGLE_CLIENT_SECRET|SESSION_KEY"/);
  });

  it("bounds cost and closes the raw endpoint to everyone but this distribution", () => {
    prod.hasResourceProperties("AWS::Lambda::WebFunctionEndpoint", { AuthType: "IamAuth", ScalingConfig: { MaxEnvironments: 2 }, ThrottleConfig: { RateLimit: 100 } });
    prod.hasResourceProperties("AWS::Lambda::ResourcePolicy", {
      PolicyDocument: {
        Statement: [
          Match.objectLike({
            Principal: { Service: "cloudfront.amazonaws.com" },
            Action: "lambda:InvokeWebFunctionEndpoint",
            Condition: { StringEquals: { "aws:SourceArn": Match.anyValue() } },
          }),
        ],
      },
    });
  });

  it("serves through CloudFront with OAC, no caching of pages, HTTPS only, and + re-encoding", () => {
    prod.hasResourceProperties("AWS::CloudFront::OriginAccessControl", {
      OriginAccessControlConfig: { OriginAccessControlOriginType: "lambda", SigningBehavior: "always-amz-auth" },
    });
    prod.hasResourceProperties("AWS::CloudFront::Distribution", {
      DistributionConfig: Match.objectLike({
        Aliases: ["mail.whitebirch.io"],
        Origins: [Match.objectLike({ OriginAccessControlId: Match.anyValue() })],
        DefaultCacheBehavior: Match.objectLike({
          ViewerProtocolPolicy: "redirect-to-https",
          CachePolicyId: "4135ea2d-6df8-44a3-9df3-4b5a84be39ad", // Managed-CachingDisabled
          FunctionAssociations: [Match.objectLike({ EventType: "viewer-request" })],
        }),
      }),
    });
  });

  it("keeps logs for 30 days in both groups", () => {
    prod.resourceCountIs("AWS::Logs::LogGroup", 2);
    for (const name of ["/aws/lambda/web/mail-web", "/aws/lambda/web/mail-web.local"]) {
      prod.hasResourceProperties("AWS::Logs::LogGroup", { LogGroupName: name, RetentionInDays: 30 });
    }
  });

  it("has no standing-cost resources", () => {
    for (const type of ["AWS::RDS::DBInstance", "AWS::EC2::NatGateway", "AWS::SecretsManager::Secret", "AWS::WAFv2::WebACL", "AWS::DynamoDB::Table"]) {
      prod.resourceCountIs(type, 0);
    }
  });
});

describe("MailCi", () => {
  it("imports GitHub's existing OIDC provider rather than creating one", () => {
    ci.resourceCountIs("AWS::IAM::OIDCProvider", 0);
    ci.resourceCountIs("Custom::AWSCDKOpenIdConnectProvider", 0);
  });

  it("trusts only main of this repo, and can only assume CDK's bootstrap roles", () => {
    ci.hasResourceProperties("AWS::IAM::Role", {
      RoleName: "mail-github-deploy",
      AssumeRolePolicyDocument: {
        Statement: [
          Match.objectLike({
            Action: "sts:AssumeRoleWithWebIdentity",
            Condition: {
              StringEquals: {
                "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
                "token.actions.githubusercontent.com:sub": "repo:whitebirchio@1/mail@2:ref:refs/heads/main",
              },
            },
          }),
        ],
      },
    });
    const statements = roleStatements(ci);
    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatchObject({ Action: "sts:AssumeRole", Resource: "arn:aws:iam::123456789012:role/cdk-hnb659fds-*-123456789012-us-east-1" });
  });
});
