<?php

declare(strict_types=1);

namespace SharedKernel\Infrastructure\Symfony\Repository;

use Common\Repository\FilterableRepositoryTrait;
use Common\Repository\ListableRepositoryInterface;
use Common\Repository\PaginableRepositoryTrait;
use Doctrine\Bundle\DoctrineBundle\Repository\ServiceEntityRepository;
use Doctrine\ORM\QueryBuilder;
use Doctrine\Persistence\ManagerRegistry;
use SharedKernel\Domain\Model\Language;
use SharedKernel\Domain\Repository\LanguageRepositoryInterface;

/**
 * @extends ServiceEntityRepository<Language>
 *
 * @implements ListableRepositoryInterface<Language>
 */
class LanguageRepository extends ServiceEntityRepository implements LanguageRepositoryInterface, ListableRepositoryInterface
{
    use FilterableRepositoryTrait;
    use PaginableRepositoryTrait;

    public function __construct(ManagerRegistry $registry)
    {
        parent::__construct($registry, Language::class);
    }

    public function save(Language $language): void
    {
        $this->getEntityManager()->persist($language);
    }

    public function findById(int $id): ?Language
    {
        return $this->find($id);
    }

    /**
     * @param list<int> $ids
     *
     * @return list<Language>
     */
    public function findByIds(array $ids): array
    {
        if ([] === $ids) {
            return [];
        }

        return $this->findBy(['id' => $ids]);
    }

    public function findByCode(string $code): ?Language
    {
        return $this->findOneBy(['code' => $code]);
    }

    public function createListQueryBuilder(): QueryBuilder
    {
        return $this->createQueryBuilder('l');
    }
}
