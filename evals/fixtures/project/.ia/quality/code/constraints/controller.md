---
paths:
  - "src/**/Controller/**/*Controller.php"
---

# Constraints — Contrôleurs Symfony

Scope: `src/**/Controller/**/*Controller.php` carrying `classe finale suffixée Controller, étend AbstractController, méthode __invoke ou actions #[Route]`.

## Static Rules

```rules
CTL-002 | present | ^final class | MUST Un contrôleur concret est déclaré final | gate!=^abstract class
CTL-004 | absent | name: '(app|admin|public)_ | MUST Le name: d'un #[Route] est relatif, sans préfixe de host | gate=#\[Route\(
CTL-011 | present | ^namespace [A-Za-z]+\\Infrastructure\\Symfony\\Controller\\(Admin|App|Public|Api) | MUST Un contrôleur vit sous Infrastructure\Symfony\Controller\{Admin,App,Public,Api} de son contexte | gate!=^namespace Common\\
```

## Semantic Rules

- MUST: Un contrôleur porte une action unique exposée par __invoke. Trigger: toute classe de contrôleur du périmètre. Anchor: méthode publique __invoke, sans autre action publique routée. — coherence, non-blocking (121/125)
- MUST: Le template rendu vit sous le dossier du host servi par le contrôleur. Trigger: appel à $this->render(). Anchor: chemin de template préfixé app/, public/ ou admin/, miroir du segment de namespace. — coherence, non-blocking (70/73)
- MUST: Le DTO de formulaire est resserré par assertValid() avant d'alimenter un message. Trigger: action qui construit un formulaire adossé à un Dto. Anchor: appel $dto->assertValid() après isSubmitted() && isValid(), avant le dispatch. (23/23)
- MUST NOT: Un contrôleur ne persiste pas lui-même : l'écriture passe par le bus de commandes. Trigger: action modifiant l'état applicatif. Anchor: aucun EntityManagerInterface ni flush() ; un $commandBus->dispatch(new …) à la place. (125/125)
- MUST: Le contrôle d'accès est porté par l'attribut #[IsGranted], pas par un appel impératif. Trigger: action soumise à un rôle ou à un voter. Anchor: #[IsGranted(...)] au-dessus de la classe ou de l'action. (120/125)
- SHOULD: Un message flash est traduit avec un domaine explicite. Trigger: appel à $this->addFlash(). Anchor: $this->translator->trans('clé', domain: 'contexte') comme second argument. — coherence, non-blocking (45/47)
- MUST: Le MessageBusInterface injecté est nommé $commandBus ou $queryBus selon le bus visé. Trigger: injection d'un MessageBusInterface, en constructeur ou en argument d'action. Anchor: nom de variable $commandBus ou $queryBus. (66/66)
