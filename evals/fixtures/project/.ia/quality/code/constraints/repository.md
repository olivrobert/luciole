---
paths:
  - "src/*/Infrastructure/**/Repository/**/*Repository.php"
---

# Constraints — Repositories Doctrine

Scope: `src/*/Infrastructure/**/Repository/**/*Repository.php` carrying `classe suffixée Repository étendant ServiceEntityRepository, requêtes via QueryBuilder`.

## Semantic Rules

- MUST: Un repository listable utilise FilterableRepositoryTrait et PaginableRepositoryTrait. Trigger: la classe implémente Common\Repository\ListableRepositoryInterface. Anchor: use FilterableRepositoryTrait; et use PaginableRepositoryTrait; en tête de classe. (12/12)
- MUST: Une désactivation du filtre softdeleteable est réactivée dans un finally. Trigger: appel à getFilters()->disable('softdeleteable') dans une méthode de lecture. Anchor: bloc finally contenant $filters->enable('softdeleteable'). (2/2)
- SHOULD: L'accès par identifiant est exposé par une méthode findById typée plutôt que par le find() hérité. Trigger: le repository doit permettre de charger son agrégat par son identifiant. Anchor: méthode publique findById(int $id): ?Entite déléguant à $this->find($id). (13/13)
- MUST: Un repository d'infrastructure implémente l'interface de repository déclarée dans le Domain de son contexte. Trigger: déclaration de la classe Repository sous Infrastructure/Symfony/Repository. Anchor: clause implements {Entite}RepositoryInterface importée depuis {Contexte}\Domain\Repository. (17/18)
- MUST: Une méthode de requête prenant un tableau en paramètre retourne le résultat vide avant d'interroger la base quand ce tableau est vide. Trigger: méthode de lecture dont un paramètre est un array (liste d'identifiants ou d'entités) injecté dans un IN (:ids). Anchor: garde if ([] === $param) { return []; } en première instruction de la méthode. (9/9)
- SHOULD: Un join dont les données sont exposées à l'appelant est doublé d'un addSelect de son alias. Trigger: méthode de lecture qui joint une association dont l'appelant lira les entités (liste, export, hydratation). Anchor: ->addSelect('alias') immédiatement après le ->leftJoin/innerJoin correspondant. (7/7)
