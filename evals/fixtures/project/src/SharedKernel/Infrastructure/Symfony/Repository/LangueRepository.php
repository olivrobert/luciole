<?php

declare(strict_types=1);

namespace SharedKernel\Infrastructure\Symfony\Repository;

use Common\Repository\FilterableRepositoryTrait;
use Common\Repository\ListableRepositoryInterface;
use Common\Repository\PaginableRepositoryTrait;
use Doctrine\Bundle\DoctrineBundle\Repository\ServiceEntityRepository;
use Doctrine\ORM\QueryBuilder;
use Doctrine\Persistence\ManagerRegistry;
use SharedKernel\Domain\Model\Langue;
use SharedKernel\Domain\Repository\LangueRepositoryInterface;

/**
 * @extends ServiceEntityRepository<Langue>
 *
 * @implements ListableRepositoryInterface<Langue>
 */
class LangueRepository extends ServiceEntityRepository implements LangueRepositoryInterface, ListableRepositoryInterface
{
    use FilterableRepositoryTrait;
    use PaginableRepositoryTrait;

    public function __construct(ManagerRegistry $registry)
    {
        parent::__construct($registry, Langue::class);
    }

    public function save(Langue $langue): void
    {
        $this->getEntityManager()->persist($langue);
    }

    public function findById(int $id): ?Langue
    {
        return $this->find($id);
    }

    /**
     * @param list<int> $ids
     *
     * @return list<Langue>
     */
    public function findByIds(array $ids): array
    {
        if ([] === $ids) {
            return [];
        }

        return $this->findBy(['id' => $ids]);
    }

    public function findByCode(string $code): ?Langue
    {
        return $this->findOneBy(['code' => $code]);
    }

    public function createListQueryBuilder(): QueryBuilder
    {
        return $this->createQueryBuilder('l');
    }
}
