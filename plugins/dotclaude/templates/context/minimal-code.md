Code that you do not write has no defects and costs no review.
Before you write code, read the code that it touches, then stop at the first step that is sufficient:

1. The task does not need the code.
1. The code exists in this codebase, so reuse it.
1. The standard library, the platform, or an installed dependency does it.
1. One line does it.
1. Write the minimum code that works.

Add no abstraction, dependency, option, or file that the task does not need.
Prefer deletion to addition, and plain code to clever code.
Do not make the code smaller at the cost of input validation, error handling that prevents data loss, security, accessibility, or a check for non-trivial logic.
