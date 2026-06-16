# Calling [toString] on an [Output<T>] is not supported.

To get the value of an Output<T> as an Output<string> consider either:
1: o.apply(v => `prefix${v}suffix`)
2: pulumi.interpolate `prefix${v}suffix`

See https://www.pulumi.com/docs/concepts/inputs-outputs for more details.

Or use ESLint with https://github.com/pulumi/eslint-plugin-pulumi to warn or
error lint on using Output<T> in template literals.
This function may throw in a future version of @pulumi/pulumi.

Managed by [thaw-platform](https://github.com/thaw-app/thaw-platform).
