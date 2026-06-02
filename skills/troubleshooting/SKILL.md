---
name: troubleshooting
description: Use when debugging an application, fixing a crash, or resolving unexpected behavior to systematically identify and resolve the root cause.
---

# Troubleshooting Applications

## Overview

A systematic approach to debugging and troubleshooting applications. Instead of guessing and making random changes, follow a structured process to identify the root cause, verify it, and apply a fix that guarantees the problem is resolved.

## When to Use

- An application is crashing or throwing errors
- Unexpected behavior or logical bugs are reported
- You need to debug an issue in an unfamiliar codebase
- Tests are failing unexpectedly

## The Troubleshooting Process

1. **Understand the Problem:**
   - Read the error message, stack trace, and logs carefully. 
   - Understand what the application was *supposed* to do versus what it *actually* did.
   - Do not skip reading the full stack trace.

2. **Reproduce the Issue:**
   - Find a reliable way to reproduce the bug. If you can't reproduce it, you can't prove you fixed it.
   - Write a failing test case if possible.

3. **Isolate the Root Cause:**
   - Use logging, debuggers, or a divide-and-conquer approach.
   - Narrow down the problem to a specific subsystem, file, and eventually a specific line of code.
   - Trace the flow of data to see where it deviates from expectations.

4. **Formulate a Hypothesis:**
   - State clearly why the bug is happening before you change any code.
   - Example: "The variable is null because the database query returns an empty result set when the ID is not found."

5. **Apply the Fix:**
   - Make the minimal change necessary to fix the bug.
   - Avoid unrelated refactoring while fixing a bug.

6. **Verify the Fix:**
   - Run the reproduction steps (or the failing test case) again to ensure the bug is gone.
   - Ensure you haven't broken any related functionality.

7. **Prevent Regression:**
   - Ensure there is a test that would have caught this bug to prevent it from coming back.

## Common Mistakes

- **Guessing:** Making random changes and hoping the bug goes away.
- **Fixing the Symptom:** Catching an exception or adding a null check without understanding *why* the exception was thrown or why the value was null.
- **Not Reproducing:** Assuming a fix works without verifying it against the original problem.
- **Changing Too Much:** Refactoring unrelated code while fixing a bug, which can introduce new bugs and obscure the fix.

## Quick Reference Checklist

- [ ] Full error message and stack trace reviewed?
- [ ] Reliable reproduction steps identified?
- [ ] Root cause isolated to a specific component/line?
- [ ] Minimal fix applied without unrelated refactoring?
- [ ] Fix verified against reproduction steps?
- [ ] Regression test added or existing test updated?
