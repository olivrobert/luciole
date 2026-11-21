---
paths:
  - "src/**/Controller/**/*Controller.php"
---

# Constraints — Symfony controllers

Scope: `src/**/Controller/**/*Controller.php` carrying `final class suffixed Controller, extends AbstractController, __invoke method or #[Route] actions`.

## Static Rules

```rules
CTL-002 | present | ^final class | MUST A concrete controller is declared final | gate!=^abstract class
CTL-004 | absent | name: '(app|admin|public)_ | MUST The name: of a #[Route] is relative, without a host prefix | gate=#\[Route\(
CTL-011 | present | ^namespace [A-Za-z]+\\Infrastructure\\Symfony\\Controller\\(Admin|App|Public|Api) | MUST A controller lives under Infrastructure\Symfony\Controller\{Admin,App,Public,Api} of its context | gate!=^namespace Common\\
```

## Semantic Rules

- MUST: A controller carries a single action exposed by __invoke. Trigger: any controller class in scope. Anchor: public __invoke method, with no other public routed action. — coherence, non-blocking (121/125)
- MUST: The rendered template lives under the folder of the host the controller serves. Trigger: call to $this->render(). Anchor: template path prefixed app/, public/ or admin/, mirroring the namespace segment. — coherence, non-blocking (70/73)
- MUST: The form DTO is narrowed by assertValid() before feeding a message. Trigger: action building a form backed by a Dto. Anchor: call to $dto->assertValid() after isSubmitted() && isValid(), before the dispatch. (23/23)
- MUST NOT: A controller does not persist by itself: writes go through the command bus. Trigger: action changing application state. Anchor: no EntityManagerInterface nor flush(); a $commandBus->dispatch(new …) instead. (125/125)
- MUST: Access control is carried by the #[IsGranted] attribute, not by an imperative call. Trigger: action subject to a role or a voter. Anchor: #[IsGranted(...)] above the class or the action. (120/125)
- SHOULD: A flash message is translated with an explicit domain. Trigger: call to $this->addFlash(). Anchor: $this->translator->trans('key', domain: 'context') as the second argument. — coherence, non-blocking (45/47)
- MUST: The injected MessageBusInterface is named $commandBus or $queryBus depending on the bus. Trigger: injection of a MessageBusInterface, in the constructor or as an action argument. Anchor: variable name $commandBus or $queryBus. (66/66)
