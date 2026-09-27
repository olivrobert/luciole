---
paths:
  - "src/Controller/**/*.php"
---

## Static Rules

```rules
CTL-001 | present | #\[Route\( | MUST have a #[Route] attribute
CTL-002 | absent  | ->flush\(  | MUST NOT flush the EntityManager: mutations go through the command bus
```

## Semantic Rules

- MUST NOT: Read the logged-in user with `$this->getUser()`. Trigger: an action needs the current user. Anchor: a `#[CurrentUser] User $user` parameter in the action signature.
- MUST NOT: Persist or save an entity from the controller. Trigger: an action that creates or changes an entity. Anchor: `$this->commandBus->dispatch(new <Command>(...))` as the only mutation.
