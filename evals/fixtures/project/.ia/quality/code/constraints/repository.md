---
paths:
  - "src/*/Infrastructure/**/Repository/**/*Repository.php"
---

# Constraints — Doctrine repositories

Scope: `src/*/Infrastructure/**/Repository/**/*Repository.php` carrying `class suffixed Repository extending ServiceEntityRepository, queries through the QueryBuilder`.

## Semantic Rules

- MUST: A listable repository uses FilterableRepositoryTrait and PaginableRepositoryTrait. Trigger: the class implements Common\Repository\ListableRepositoryInterface. Anchor: use FilterableRepositoryTrait; and use PaginableRepositoryTrait; at the top of the class. (12/12)
- MUST: Disabling the softdeleteable filter is undone in a finally block. Trigger: call to getFilters()->disable('softdeleteable') in a read method. Anchor: finally block containing $filters->enable('softdeleteable'). (2/2)
- SHOULD: Access by identifier is exposed by a typed findById method rather than the inherited find(). Trigger: the repository must load its aggregate by identifier. Anchor: public method findById(int $id): ?Entity delegating to $this->find($id). (13/13)
- MUST: An infrastructure repository implements the repository interface declared in its context's Domain. Trigger: declaration of the Repository class under Infrastructure/Symfony/Repository. Anchor: implements {Entity}RepositoryInterface clause imported from {Context}\Domain\Repository. (17/18)
- MUST: A query method taking an array parameter returns the empty result before querying the database when that array is empty. Trigger: read method with an array parameter (list of identifiers or entities) injected into an IN (:ids). Anchor: guard if ([] === $param) { return []; } as the first statement of the method. (9/9)
- SHOULD: A join whose data is exposed to the caller is paired with an addSelect of its alias. Trigger: read method joining an association whose entities the caller will read (list, export, hydration). Anchor: ->addSelect('alias') right after the matching ->leftJoin/innerJoin. (7/7)
