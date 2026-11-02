import { CfnOutput, Stack, type StackProps, Tags } from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import type { Construct } from "constructs";
import { DOMAIN } from "./config.js";

/**
 * The certificate for mail.whitebirch.io. It's its own stack because DNS
 * validation waits until the owner adds the CNAME in Cloudflare
 * (`aws acm describe-certificate` lists it). Deploy it once from the laptop;
 * MailProduction then references it.
 */
export class CertsStack extends Stack {
  readonly certificate: acm.ICertificate;

  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);
    Tags.of(this).add("app", "mail");
    const cert = new acm.Certificate(this, "Mail", { domainName: DOMAIN, validation: acm.CertificateValidation.fromDns() });
    this.certificate = cert;
    new CfnOutput(this, "CertificateArn", { value: cert.certificateArn });
  }
}
